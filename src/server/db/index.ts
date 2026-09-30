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

export default db;
