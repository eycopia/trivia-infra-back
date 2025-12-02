const db = require('./db');
require('dotenv').config();

async function migrate() {
    try {
        console.log('Dropping total_winners column...');
        await db.query('ALTER TABLE games DROP COLUMN IF EXISTS total_winners;');
        console.log('Migration successful');
    } catch (err) {
        console.error('Migration failed:', err);
    } finally {
        process.exit();
    }
}

migrate();
