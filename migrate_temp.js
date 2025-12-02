require('dotenv').config();
const db = require('./db');

async function runMigration() {
    try {
        console.log('Running migration...');
        await db.query("ALTER TABLE games ADD COLUMN IF NOT EXISTS status TEXT DEFAULT 'WAITING';");
        console.log('Migration successful!');
        process.exit(0);
    } catch (err) {
        console.error('Migration failed:', err);
        process.exit(1);
    }
}

runMigration();
