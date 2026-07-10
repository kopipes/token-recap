const { MetricServiceClient } = require('@google-cloud/monitoring');
const path = require('path');
const db = require('./database');

const METRICS_TO_FETCH = [
    // Vertex AI token count (input + output combined, labeled by type)
    'aiplatform.googleapis.com/publisher/online_serving/token_count',
    // Generative Language API - input tokens (paid tier)
    // Only PerModelPerMinute limit_name is used to avoid double-counting
    // (GCP exposes both PerModelPerMinute and PerModelPerMinutePerUser with identical values)
    'generativelanguage.googleapis.com/quota/generate_content_paid_tier_input_token_count/usage',
    // Generative Language API - output tokens with modality label (text/audio/image)
    'generativelanguage.googleapis.com/generate_content_usage_output_token_count',
];

async function fetchMetric(client, projectId, metricType, name, startTime, endTime) {
    // For paid_tier_input metric, filter to only PerModelPerMinute to avoid double-counting.
    // GCP exposes both PerModelPerMinute and PerModelPerMinutePerUser with identical values.
    const isPaidTierInput = metricType.includes('generate_content_paid_tier_input_token_count');
    const filter = isPaidTierInput
        ? `metric.type="${metricType}" AND metric.labels.limit_name="GenerateContentPaidTierInputTokensPerModelPerMinute"`
        : `metric.type="${metricType}"`;

    const request = {
        name: name,
        filter,
        interval: {
            startTime: { seconds: Math.floor(startTime.getTime() / 1000) },
            endTime: { seconds: Math.floor(endTime.getTime() / 1000) },
        },
        view: 'FULL',
    };

    let insertedCount = 0;
    try {
        const [timeSeries] = await client.listTimeSeries(request);

        for (const series of timeSeries) {
            const metricLabels = series.metric.labels || {};
            const resourceLabels = series.resource.labels || {};

            // Logic to handle both Vertex AI and Gen Lang API labels
            let model = 'unknown';
            if (resourceLabels.model_user_id) model = resourceLabels.model_user_id;
            else if (metricLabels.model) model = metricLabels.model;

            let tokenType = 'unknown';
            if (metricLabels.type) tokenType = metricLabels.type;
            else if (metricType.includes('input')) tokenType = 'input';
            else if (metricType.includes('output')) tokenType = 'output';

            // Capture modality from output metric label (e.g. "text", "audio", "image")
            // For thinking tokens, append "_thinking" to distinguish billing tier
            let modality = metricLabels.output_modality || null;
            if (modality && metricLabels.thinking_enabled === 'true') {
                modality = modality + '_thinking';
            }

            const projId = resourceLabels.project_id || projectId;

            for (const point of series.points) {
                const timestamp = new Date(point.interval.endTime.seconds * 1000).toISOString();
                // Google returns int64Value as a STRING — must parse explicitly
                const tokenCount = parseInt(point.value.int64Value) || parseFloat(point.value.doubleValue) || 0;

                if (tokenCount > 0) {
                    await new Promise((resolve) => {
                        db.run(`
                            INSERT OR IGNORE INTO token_logs (timestamp, token_count, token_type, model, project_id, modality)
                            VALUES (?, ?, ?, ?, ?, ?)
                        `, [timestamp, tokenCount, tokenType, model, projId, modality], function (err) {
                            if (err) console.error('Error inserting log:', err.message);
                            else if (this.changes > 0) insertedCount++;
                            resolve();
                        });
                    });
                }
            }
        }
        return insertedCount;
    } catch (error) {
        console.error(`[${projectId}] Error fetching metric ${metricType}:`, error.message);
        return 0;
    }
}

/**
 * After syncing, backfill modality on input records that have no modality
 * by matching them to the nearest output record within the same minute,
 * for the same model and project_id.
 * GCP's input metric has no modality label, but the output metric does.
 */
async function backfillInputModality(projectId) {
    return new Promise((resolve, reject) => {
        db.run(`
            UPDATE token_logs
            SET modality = (
                SELECT out.modality
                FROM token_logs out
                WHERE out.token_type = 'output'
                  AND out.modality IS NOT NULL
                  AND out.model = token_logs.model
                  AND out.project_id = token_logs.project_id
                  AND strftime('%Y-%m-%dT%H', out.timestamp) = strftime('%Y-%m-%dT%H', token_logs.timestamp)
                LIMIT 1
            )
            WHERE token_type = 'input'
              AND modality IS NULL
              AND project_id = ?
        `, [projectId], function(err) {
            if (err) reject(err);
            else resolve(this.changes);
        });
    });
}

/**
 * Sync metrics for a single project.
 * @param {object} projectConfig - { id, credentials, label }
 */
async function syncGcpMetrics(projectConfig, startTimeStr, endTimeStr) {
    const { id: projectId, credentials, label } = projectConfig;
    const displayName = label || projectId;

    console.log(`[${displayName}] Starting sync from ${startTimeStr} to ${endTimeStr}`);

    // Create a per-project client using the project's own credentials file
    const clientOptions = credentials
        ? { keyFilename: path.resolve(__dirname, credentials) }
        : {}; // Fall back to GOOGLE_APPLICATION_CREDENTIALS env var

    const client = new MetricServiceClient(clientOptions);
    const name = client.projectPath(projectId);

    const startTime = new Date(startTimeStr);
    const endTime = new Date(endTimeStr);
    endTime.setHours(23, 59, 59, 999);

    let totalInserted = 0;
    for (const metric of METRICS_TO_FETCH) {
        const count = await fetchMetric(client, projectId, metric, name, startTime, endTime);
        totalInserted += count;
    }

    // Backfill modality on input records by matching output records at same timestamp/model/project
    const backfilled = await backfillInputModality(projectId);
    if (backfilled > 0) {
        console.log(`[${displayName}] Backfilled modality on ${backfilled} input records.`);
    }

    console.log(`[${displayName}] Sync complete. Inserted ${totalInserted} new log points.`);
    return { projectId, label: displayName, success: true, count: totalInserted };
}

/**
 * Sync metrics for ALL projects listed in projects.json.
 * Falls back to single-project mode using .env if projects.json doesn't exist.
 */
async function syncAllProjects(startTimeStr, endTimeStr) {
    const projectsFile = path.join(__dirname, 'projects.json');
    let projects = [];

    if (require('fs').existsSync(projectsFile)) {
        projects = JSON.parse(require('fs').readFileSync(projectsFile, 'utf8'));
    } else {
        // Legacy single-project fallback
        const singleId = process.env.GOOGLE_CLOUD_PROJECT_ID;
        const singleCreds = process.env.GOOGLE_APPLICATION_CREDENTIALS;
        if (!singleId) throw new Error('GOOGLE_CLOUD_PROJECT_ID is not configured');
        projects = [{ id: singleId, credentials: singleCreds, label: singleId }];
    }

    const results = [];
    let grandTotal = 0;
    for (const project of projects) {
        const result = await syncGcpMetrics(project, startTimeStr, endTimeStr);
        results.push(result);
        grandTotal += result.count;
    }

    return { success: true, projects: results, totalInserted: grandTotal };
}

module.exports = { syncGcpMetrics, syncAllProjects };
