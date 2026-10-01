import Database from 'better-sqlite3';
import path from 'path';
import fs from 'fs';
import { fileURLToPath } from 'url';
import { SCHEMA_SQL } from './schema.js';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

// Data directory priority: DATA_DIR env var -> ./data in project root
const DATA_DIR = process.env.DATA_DIR || path.resolve(process.cwd(), 'data');

if (!fs.existsSync(DATA_DIR)) {
  fs.mkdirSync(DATA_DIR, { recursive: true });
}

const DB_PATH = path.join(DATA_DIR, 'app.db');

export const db: Database.Database = new Database(DB_PATH);

// Enable WAL mode for high performance and durability
db.pragma('journal_mode = WAL');
db.pragma('foreign_keys = ON');
db.pragma('busy_timeout = 5000');
db.pragma('synchronous = NORMAL');

// Initialize schema
db.exec(SCHEMA_SQL);

// Safe column migrations for existing databases
try {
  db.exec('ALTER TABLE playlists ADD COLUMN consecutive_episodes INTEGER NOT NULL DEFAULT 1');
} catch {}
try {
  db.exec('ALTER TABLE playlists ADD COLUMN min_consecutive_episodes INTEGER NOT NULL DEFAULT 1');
} catch {}
try {
  db.exec('ALTER TABLE playlists ADD COLUMN max_consecutive_episodes INTEGER NOT NULL DEFAULT 1');
} catch {}
try {
  db.exec('ALTER TABLE playlist_shows ADD COLUMN season_count INTEGER');
} catch {}
try {
  db.exec('ALTER TABLE playlist_shows ADD COLUMN total_episodes INTEGER');
} catch {}
try {
  db.exec('ALTER TABLE playlist_shows ADD COLUMN unwatched_episodes INTEGER');
} catch {}

try {
  db.exec("ALTER TABLE settings ADD COLUMN plex_client_id TEXT NOT NULL DEFAULT ''");
} catch {}

// Note: SQLite does not support ALTER COLUMN to change type.
// manual_weight column stores REAL values correctly even if schema shows INTEGER (SQLite is type-flexible).
// New databases will use the REAL type declared in the schema above.

// Graceful shutdown — ensure WAL checkpoint completes
process.on('exit', () => {
  try { db.close(); } catch {}
});
process.on('SIGINT', () => process.exit(0));
process.on('SIGTERM', () => process.exit(0));

export default db;
