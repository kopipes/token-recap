const { syncGcpMetrics } = require('./gcpClient');

(async () => {
    try {
        const projectId = process.env.GOOGLE_CLOUD_PROJECT_ID;
        const res = await syncGcpMetrics(projectId, "2026-04-01", "2026-04-30");
        console.log("Result:", res);
    } catch (e) {
        console.error(e);
    }
})();
