import Database from 'better-sqlite3';
import path from 'path';
import fs from 'fs';

const DB_PATH = process.env.DATABASE_PATH || path.join(process.cwd(), 'data', 'chat.db');

// Ensure data directory exists
const dir = path.dirname(DB_PATH);
if (!fs.existsSync(dir)) {
  fs.mkdirSync(dir, { recursive: true });
}

// Global db instance for server-side Next.js
declare global {
  // eslint-disable-next-line no-var
  var __dbInstance: Database.Database | undefined;
}

function getDatabase(): Database.Database {
  if (global.__dbInstance) {
    return global.__dbInstance;
  }

  const db = new Database(DB_PATH);

  // WAL mode for high concurrency and performance
  db.pragma('journal_mode = WAL');
  db.pragma('synchronous = NORMAL');
  db.pragma('foreign_keys = ON');
  db.pragma('busy_timeout = 5000');

  // Initialize schema if tables don't exist
  const schemaPath = path.join(process.cwd(), 'src', 'lib', 'db', 'schema.sql');
  if (fs.existsSync(schemaPath)) {
    const schemaSql = fs.readFileSync(schemaPath, 'utf8');
    db.exec(schemaSql);
  }

  // Migrasi ringan untuk database lama: CREATE TABLE IF NOT EXISTS tidak
  // menambahkan kolom baru pada tabel yang sudah ada.
  try {
    const settingCols = db.prepare('PRAGMA table_info(user_settings)').all() as Array<{ name: string }>;
    if (!settingCols.some((c) => c.name === 'memory_enabled')) {
      db.exec('ALTER TABLE user_settings ADD COLUMN memory_enabled INTEGER NOT NULL DEFAULT 1');
    }
  } catch (err: any) {
    console.warn('[DB] Migrasi memory_enabled gagal:', err.message);
  }

  if (process.env.NODE_ENV !== 'production') {
    global.__dbInstance = db;
  }

  return db;
}

export const db = getDatabase();
export default db;
