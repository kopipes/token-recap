const sqlite3 = require('sqlite3').verbose();
const path = require('path');

// Connect to SQLite database
const dbPath = path.resolve(__dirname, 'database.sqlite');
const db = new sqlite3.Database(dbPath, (err) => {
    if (err) {
        console.error('Error opening database', err.message);
    } else {
        console.log('Connected to the SQLite database.');
        
        // Create table if it doesn't exist
        db.run(`CREATE TABLE IF NOT EXISTS token_logs (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            timestamp DATETIME NOT NULL,
            token_count INTEGER NOT NULL,
            token_type TEXT,
            model TEXT NOT NULL,
            project_id TEXT,
            modality TEXT,
            UNIQUE(timestamp, model, token_type, project_id, modality)
        )`, (err) => {
            if (err) {
                console.error('Error creating table', err.message);
            } else {
                console.log('token_logs table is ready.');
                // Migrate: add modality column if it doesn't exist yet (for existing DBs)
                db.run(`ALTER TABLE token_logs ADD COLUMN modality TEXT`, (alterErr) => {
                    // Ignore error if column already exists
                    if (alterErr && !alterErr.message.includes('duplicate column')) {
                        console.error('Migration error:', alterErr.message);
                    }
                    // Migrate: update UNIQUE constraint requires rebuilding the table.
                    // We handle this by dropping and recreating only if the old unique index exists.
                    db.run(`
                        CREATE UNIQUE INDEX IF NOT EXISTS idx_token_logs_unique
                        ON token_logs(timestamp, model, token_type, project_id, modality)
                    `, (idxErr) => {
                        if (idxErr && !idxErr.message.includes('already exists')) {
                            console.error('Index migration error:', idxErr.message);
                        } else {
                            console.log('modality column and index ready.');
                        }
                    });
                });
            }
        });
    }
});

module.exports = db;
