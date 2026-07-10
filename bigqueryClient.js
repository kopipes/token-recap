const { BigQuery } = require('@google-cloud/bigquery');
const path = require('path');
const db = require('./database');

// SKU description → { token_type, modality }
// Based on actual GCP billing SKU names observed in billing export
const SKU_MAP = {
    // Output tokens
    'generate content output token count gemini 2.5 flash short input text': { token_type: 'output', modality: 'text' },
    'generate content output token count gemini 2.5 flash long input text':  { token_type: 'output', modality: 'text_long' },
    // Input tokens
    'generate content input token count gemini 2.5 flash short input text':  { token_type: 'input', modality: 'text' },
    'generate content input token count gemini 2.5 flash long input text':   { token_type: 'input', modality: 'text_long' },
    'generate content input token count gemini 2.5 flash input audio':       { token_type: 'input', modality: 'audio' },
    'generate content input token count gemini 2.5 flash input image':       { token_type: 'input', modality: 'image' },
    'generate content input token count gemini 2.5 flash input video':       { token_type: 'input', modality: 'video' },
    // Cached input tokens
    'generate content cached input token count gemini 2.5 flash input short text': { token_type: 'input', modality: 'text_cached' },
    'generate content cached input token count gemini 2.5 flash input audio':      { token_type: 'input', modality: 'audio_cached' },
};

/**
 * Normalize SKU description to lowercase and strip extra whitespace for matching.
 */
function normalizeSku(sku) {
    return sku.toLowerCase().replace(/\s+/g, ' ').trim();
}

/**
 * Extract model name from SKU description.
 * e.g. "Generate content output token count gemini 2.5 flash short input text" → "gemini-2.5-flash"
 */
function extractModel(sku) {
    const lower = sku.toLowerCase();
    if (lower.includes('gemini 2.5 flash lite')) return 'gemini-2.5-flash-lite';
    if (lower.includes('gemini 2.5 flash'))      return 'gemini-2.5-flash';
    if (lower.includes('gemini 2.5 pro'))        return 'gemini-2.5-pro';
    if (lower.includes('gemini 2.0 flash'))      return 'gemini-2.0-flash';
    if (lower.includes('gemini 1.5 flash'))      return 'gemini-1.5-flash';
    if (lower.includes('gemini 1.5 pro'))        return 'gemini-1.5-pro';
    return 'unknown';
}

/**
 * Query BigQuery billing export for a date range and insert into token_logs.
 * Table: new-ai-scoring.dipo_billing_export.gcp_billing_export_v1_*
 *
 * @param {string} startDate - YYYY-MM-DD
 * @param {string} endDate   - YYYY-MM-DD
 */
async function syncBillingData(startDate, endDate) {
    const keyFilename = path.resolve(__dirname, './new-ai-scoring-d4425928c870.json');
    const bq = new BigQuery({ keyFilename, projectId: 'new-ai-scoring' });

    // Find the actual table name (format: gcp_billing_export_v1_XXXXXX_XXXXXX_XXXXXX)
    const [tables] = await bq.dataset('dipo_billing_export').getTables();
    if (!tables.length) {
        throw new Error('No billing export tables found yet. GCP syncs daily — try again tomorrow.');
    }

    // Use the first detailed export table (could be gcp_billing_export_v1_* or gcp_billing_export_resource_v1_*)
    const tableName = tables.find(t => t.id.startsWith('gcp_billing_export_v1') || t.id.startsWith('gcp_billing_export_resource_v1'))?.id;
    if (!tableName) {
        throw new Error(`No billing export table found. Available: ${tables.map(t => t.id).join(', ')}`);
    }

    console.log(`[BillingSync] Using table: ${tableName}`);

    // Query daily SKU-level usage for Gemini API rows only
    const query = `
        SELECT
            DATE(usage_start_time) as usage_date,
            project.id as project_id,
            sku.description as sku_description,
            SUM(usage.amount) as token_count
        FROM \`new-ai-scoring.dipo_billing_export.${tableName}\`
        WHERE
            service.description = 'Gemini API'
            AND DATE(usage_start_time) >= @startDate
            AND DATE(usage_start_time) <= @endDate
            AND usage.amount > 0
        GROUP BY usage_date, project_id, sku_description
        ORDER BY usage_date, project_id, sku_description
    `;

    const options = {
        query,
        params: { startDate, endDate },
        location: 'asia-southeast1',
    };

    const [rows] = await bq.query(options);
    console.log(`[BillingSync] Found ${rows.length} billing rows for ${startDate} to ${endDate}`);

    let insertedCount = 0;
    let skippedCount = 0;

    for (const row of rows) {
        const skuNorm = normalizeSku(row.sku_description);
        const mapping = SKU_MAP[skuNorm];

        if (!mapping) {
            console.log(`[BillingSync] Unmapped SKU (skipping): ${row.sku_description}`);
            skippedCount++;
            continue;
        }

        const { token_type, modality } = mapping;
        const model = extractModel(row.sku_description);
        const projectId = row.project_id;
        const tokenCount = Math.round(Number(row.token_count));

        // Use noon UTC of the usage date as timestamp for billing rows
        const timestamp = `${row.usage_date}T12:00:00.000Z`;

        await new Promise((resolve) => {
            db.run(`
                INSERT OR IGNORE INTO token_logs (timestamp, token_count, token_type, model, project_id, modality)
                VALUES (?, ?, ?, ?, ?, ?)
            `, [timestamp, tokenCount, token_type, model, projectId, modality], function(err) {
                if (err) console.error('[BillingSync] Insert error:', err.message);
                else if (this.changes > 0) insertedCount++;
                resolve();
            });
        });
    }

    console.log(`[BillingSync] Done. Inserted: ${insertedCount}, Skipped (unmapped): ${skippedCount}`);
    return { insertedCount, skippedCount, totalRows: rows.length };
}

module.exports = { syncBillingData };
