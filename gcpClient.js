const monitoring = require('@google-cloud/monitoring');
const db = require('./database');

// Creates a client
const client = new monitoring.MetricServiceClient();

async function fetchMetric(projectId, metricType, name, startTime, endTime) {
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
                const tokenCount = point.value.int64Value || point.value.doubleValue || 0;

                if (tokenCount > 0) {
                    await new Promise((resolve, reject) => {
                        db.run(`
                            INSERT OR IGNORE INTO token_logs (timestamp, token_count, token_type, model, project_id)
                            VALUES (?, ?, ?, ?, ?)
                        `, [timestamp, tokenCount, tokenType, model, projId], function(err) {
                            if (err) {
                                console.error('Error inserting log', err.message);
                                resolve(); // Continue anyway
                            } else {
                                if (this.changes > 0) insertedCount++;
                                resolve();
                            }
                        });
                    });
                }
            }
        }
        return insertedCount;
    } catch (error) {
        console.error(`Error fetching metric ${metricType}:`, error.message);
        return 0; // Skip if metric doesn't exist
    }
}

async function syncGcpMetrics(projectId, startTimeStr, endTimeStr) {
    console.log(`Starting GCP metric sync for project: ${projectId} from ${startTimeStr} to ${endTimeStr}`);
    const name = client.projectPath(projectId);

    // Set start time
    const startTime = new Date(startTimeStr);
    
    // Set end time to the end of the day (23:59:59.999) to capture all activity on that day
    const endTime = new Date(endTimeStr);
    endTime.setHours(23, 59, 59, 999);

    const metricsToFetch = [
        'aiplatform.googleapis.com/publisher/online_serving/token_count',
        'generativelanguage.googleapis.com/quota/generate_content_paid_tier_input_token_count/usage',
        'generativelanguage.googleapis.com/generate_content_usage_output_token_count'
    ];

    let totalInserted = 0;
    for (const metric of metricsToFetch) {
        const count = await fetchMetric(projectId, metric, name, startTime, endTime);
        totalInserted += count;
    }

    console.log(`Sync completed successfully. Inserted ${totalInserted} new log points.`);
    return { success: true, count: totalInserted };
}

module.exports = { syncGcpMetrics };
