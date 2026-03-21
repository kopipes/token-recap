require('dotenv').config();
const monitoring = require('@google-cloud/monitoring');
const client = new monitoring.MetricServiceClient();
const projectId = process.env.GOOGLE_CLOUD_PROJECT_ID;

async function testJan() {
  const name = client.projectPath(projectId);
  const startTime = new Date('2026-01-01T00:00:00Z');
  const endTime = new Date('2026-01-31T23:59:59Z');

  const request = {
    name: name,
    filter: 'metric.type="generativelanguage.googleapis.com/quota/generate_content_paid_tier_input_token_count/usage"',
    interval: {
        startTime: { seconds: Math.floor(startTime.getTime() / 1000) },
        endTime: { seconds: Math.floor(endTime.getTime() / 1000) },
    },
  };
  
  try {
    const [timeSeries] = await client.listTimeSeries(request);
    console.log(`Found ${timeSeries.length} timeseries for January`);
  } catch(e) { console.error('Error fetching January data:', e.message); }
}
testJan();
