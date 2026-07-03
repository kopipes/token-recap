const { MetricServiceClient } = require('@google-cloud/monitoring');
const path = require('path');
const db = require('./database');

const METRICS_TO_FETCH = [
    // Vertex AI token count (input + output combined, labeled by type)
    'aiplatform.googleapis.com/publisher/online_serving/token_count',
    // Generative Language API - input tokens (paid tier)
    'generativelanguage.googleapis.com/quota/generate_content_paid_tier_input_token_count/usage',
    // Generative Language API - output tokens (paid tier)
    'generativelanguage.googleapis.com/quota/generate_content_paid_tier_output_token_count/usage',
    // Generative Language API - output tokens (usage-based, newer metric name)
    'generativelanguage.googleapis.com/generate_content_usage_output_token_count',
];

async function fetchMetric(client, projectId, metricType, name, startTime, endTime) {
    const request = {
        name: name,
        filter: `metric.type="${metricType}"`,
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

            const projId = resourceLabels.project_id || projectId;

            for (const point of series.points) {
                const timestamp = new Date(point.interval.endTime.seconds * 1000).toISOString();
                // Google returns int64Value as a STRING — must parse explicitly
                const tokenCount = parseInt(point.value.int64Value) || parseFloat(point.value.doubleValue) || 0;

                if (tokenCount > 0) {
                    await new Promise((resolve) => {
                        db.run(`
                            INSERT OR IGNORE INTO token_logs (timestamp, token_count, token_type, model, project_id)
                            VALUES (?, ?, ?, ?, ?)
                        `, [timestamp, tokenCount, tokenType, model, projId], function (err) {
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
