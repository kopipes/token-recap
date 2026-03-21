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
            UNIQUE(timestamp, model, token_type, project_id)
        )`, (err) => {
            if (err) {
                console.error('Error creating table', err.message);
            } else {
                console.log('token_logs table is ready.');
            }
        });
    }
});

module.exports = db;
