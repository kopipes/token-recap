require('dotenv').config();
const monitoring = require('@google-cloud/monitoring');
const client = new monitoring.MetricServiceClient();
const projectId = process.env.GOOGLE_CLOUD_PROJECT_ID;

async function listDescriptors() {
  const name = client.projectPath(projectId);
  const request = {
    name: name
  };
  try {
    const [descriptors] = await client.listMetricDescriptors(request);
    descriptors.forEach(d => {
      if (d.type.includes('token_count') || d.type.includes('token')) {
         console.log(d.type);
      }
    });
  } catch(e) { console.error('Error:', e.message); }
}
listDescriptors();
