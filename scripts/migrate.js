const Database = require('better-sqlite3');
const fs = require('fs');
const path = require('path');

const DB_PATH = process.env.DATABASE_PATH || path.join(__dirname, '..', 'data', 'chat.db');
const SCHEMA_PATH = path.join(__dirname, '..', 'src', 'lib', 'db', 'schema.sql');

console.log(`[Migrate] Running migrations against database: ${DB_PATH}`);

const dir = path.dirname(DB_PATH);
if (!fs.existsSync(dir)) {
  fs.mkdirSync(dir, { recursive: true });
}

const db = new Database(DB_PATH);
db.pragma('journal_mode = WAL');
db.pragma('foreign_keys = ON');

const schemaSql = fs.readFileSync(SCHEMA_PATH, 'utf8');
db.exec(schemaSql);

console.log('[Migrate] ✓ Database schema migrated successfully.');
