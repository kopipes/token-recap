require('dotenv').config();
const monitoring = require('@google-cloud/monitoring');
const client = new monitoring.MetricServiceClient();
const projectId = process.env.GOOGLE_CLOUD_PROJECT_ID;

async function checkPoints() {
    const name = client.projectPath(projectId);
    const metricsToFetch = [
        'aiplatform.googleapis.com/publisher/online_serving/token_count',
        'generativelanguage.googleapis.com/quota/generate_content_paid_tier_input_token_count/usage',
        'generativelanguage.googleapis.com/generate_content_usage_output_token_count'
    ];
    let startTime = new Date('2026-04-01T00:00:00Z');
    let endTime = new Date('2026-04-30T23:59:59Z');

    for (const metric of metricsToFetch) {
        const request = {
            name: name,
            filter: `metric.type="${metric}"`,
            interval: {
                startTime: { seconds: Math.floor(startTime.getTime() / 1000) },
                endTime: { seconds: Math.floor(endTime.getTime() / 1000) },
            },
            view: 'FULL',
        };

        try {
            const [timeSeries] = await client.listTimeSeries(request);
            console.log(`Metric: ${metric} - Found ${timeSeries.length} timeseries`);
            let totalPoints = 0;
            timeSeries.forEach(series => {
                totalPoints += series.points.length;
                if (series.points.length > 0) {
                    console.log(`Resource Labels:`, series.resource.labels);
                    console.log(`Metric Labels:`, series.metric.labels);
                }
            });
            console.log(`  Total points fetched: ${totalPoints}`);
        } catch(e) {
            console.log(`Metric: ${metric} - Error: ${e.message}`);
        }
    }
}
checkPoints();
