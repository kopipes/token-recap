require('dotenv').config();
const express = require('express');
const cors = require('cors');
const path = require('path');
const fs = require('fs');
const https = require('https');
const db = require('./database');
const { syncAllProjects } = require('./gcpClient');
const { syncBillingData } = require('./bigqueryClient');

const app = express();
const PORT = process.env.PORT || 3000;

app.use(cors());
app.use(express.static(path.join(__dirname, 'public')));
app.use(express.json());

// Endpoint to fetch dynamic pricing
app.get('/api/pricing', (req, res) => {
    try {
        const pricingData = fs.readFileSync(path.join(__dirname, 'pricing.json'), 'utf8');
        res.json(JSON.parse(pricingData));
    } catch (error) {
        console.error('Error reading pricing.json:', error);
        res.status(500).json({ error: 'Failed to read pricing configuration' });
    }
});

// Endpoint to list configured projects (labels only, no credentials)
app.get('/api/projects', (req, res) => {
    try {
        const projectsFile = path.join(__dirname, 'projects.json');
        if (fs.existsSync(projectsFile)) {
            const projects = JSON.parse(fs.readFileSync(projectsFile, 'utf8'));
            res.json(projects.map(p => ({ id: p.id, label: p.label || p.id })));
        } else {
            const singleId = process.env.GOOGLE_CLOUD_PROJECT_ID;
            res.json([{ id: singleId, label: singleId }]);
        }
    } catch (error) {
        res.status(500).json({ error: 'Failed to read project configuration' });
    }
});


// Endpoint to auto-sync dynamic pricing from internet
app.post('/api/sync-pricing', (req, res) => {
    https.get('https://openrouter.ai/api/v1/models', (resp) => {
        let data = '';
        resp.on('data', (chunk) => { data += chunk; });
        resp.on('end', () => {
            try {
                const json = JSON.parse(data);
                let newPricing = {};
                
                json.data.forEach(model => {
                    if (model.id && model.id.startsWith('google/')) {
                        const baseName = model.id.replace('google/', '');
                        // OpenRouter gives price per 1 token, we need per 1M tokens
                        const promptPrice = parseFloat(model.pricing.prompt) * 1000000;
                        const completionPrice = parseFloat(model.pricing.completion) * 1000000;
                        newPricing[baseName] = { 
                            input: promptPrice || 0, 
                            output: completionPrice || 0 
                        };
                    }
                });

                fs.writeFileSync(path.join(__dirname, 'pricing.json'), JSON.stringify(newPricing, null, 2), 'utf8');
                res.json({ message: 'Pricing successfully synced with public registry', data: newPricing });
            } catch (err) {
                res.status(500).json({ error: 'Failed to parse JSON registry' });
            }
        });
    }).on('error', (err) => {
        res.status(500).json({ error: 'Failed to access internet registry' });
    });
});

// Endpoint to sync from GCP Billing Export in BigQuery (captures audio/image/etc modality)
app.post('/api/sync-billing', async (req, res) => {
    const { startDate, endDate } = req.body;

    if (!startDate || !endDate) {
        return res.status(400).json({ error: 'startDate and endDate are required in the request body' });
    }

    try {
        const result = await syncBillingData(startDate, endDate);
        res.json({
            message: `Billing sync complete. Inserted ${result.insertedCount} new records (${result.skippedCount} unmapped SKUs skipped).`,
            ...result
        });
    } catch (error) {
        res.status(500).json({ error: 'Failed to sync billing data from BigQuery', details: error.message });
    }
});

// Endpoint to trigger manual sync from GCP (supports multiple projects via projects.json)
app.post('/api/sync-gcp', async (req, res) => {
    const { startDate, endDate } = req.body;

    if (!startDate || !endDate) {
        return res.status(400).json({ error: 'startDate and endDate are required in the request body' });
    }

    try {
        const result = await syncAllProjects(startDate, endDate);
        const message = result.projects.length > 1
            ? `Sync successful across ${result.projects.length} projects. Total: ${result.totalInserted} new records.`
            : `Sync successful. Inserted ${result.totalInserted} new records.`;
        res.json({ message, ...result });
    } catch (error) {
        res.status(500).json({ error: 'Failed to sync with GCP', details: error.message });
    }
});

// Endpoint to fetch reports with daily, weekly, or monthly grouping
app.get('/api/reports', (req, res) => {
    const { period = 'daily', startDate, endDate, projectId, modality, timezone = 'UTC' } = req.query;

    let timeExpression = 'timestamp';
    if (timezone === 'WIB') {
        timeExpression = "datetime(timestamp, '+7 hours')";
    }

    let dateFormat;
    if (period === 'monthly') {
        dateFormat = '%Y-%m'; // YYYY-MM
    } else if (period === 'weekly') {
        dateFormat = '%Y-%W'; // YYYY-WW (Week number)
    } else if (period === 'hourly') {
        dateFormat = '%Y-%m-%d %H:00'; // YYYY-MM-DD HH:00
    } else if (period === 'minutely') {
        dateFormat = '%Y-%m-%d %H:%M'; // YYYY-MM-DD HH:MM
    } else {
        dateFormat = '%Y-%m-%d'; // YYYY-MM-DD
    }

    let query = `
        SELECT 
            strftime(?, ${timeExpression}) as period_date,
            model,
            project_id,
            modality,
            SUM(CASE WHEN token_type = 'input' THEN token_count ELSE 0 END) as input_tokens,
            SUM(CASE WHEN token_type = 'output' THEN token_count ELSE 0 END) as output_tokens,
            SUM(token_count) as total_tokens
        FROM token_logs
        WHERE 1=1
    `;
    
    const queryParams = [dateFormat];

    if (startDate) {
        query += ` AND date(${timeExpression}) >= ?`;
        queryParams.push(startDate);
    }
    
    if (endDate) {
        query += ` AND date(${timeExpression}) <= ?`;
        queryParams.push(endDate);
    }

    if (projectId && projectId !== 'all') {
        query += ` AND project_id = ?`;
        queryParams.push(projectId);
    }

    if (modality && modality !== 'all') {
        if (modality === 'none') {
            query += ` AND modality IS NULL`;
        } else {
            query += ` AND modality = ?`;
            queryParams.push(modality);
        }
    }

    query += ` GROUP BY period_date, model, project_id, modality ORDER BY period_date DESC`;


    db.all(query, queryParams, (err, rows) => {
        if (err) {
            return res.status(500).json({ error: 'Database query failed' });
        }
        res.json({ data: rows });
    });
});

app.listen(PORT, () => {
    console.log(`Server is running on http://localhost:${PORT}`);
});
