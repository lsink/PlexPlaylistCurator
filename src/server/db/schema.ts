export const SCHEMA_SQL = `
CREATE TABLE IF NOT EXISTS settings (
  id INTEGER PRIMARY KEY CHECK (id = 1),
  plex_url TEXT NOT NULL DEFAULT '',
  plex_token TEXT NOT NULL DEFAULT '',
  plex_server_name TEXT NOT NULL DEFAULT '',
  admin_password_hash TEXT,
  is_configured INTEGER NOT NULL DEFAULT 0,
  auto_sync_interval_minutes INTEGER NOT NULL DEFAULT 30,
  webhook_secret TEXT NOT NULL DEFAULT '',
  updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE IF NOT EXISTS playlists (
  id TEXT PRIMARY KEY,
  name TEXT NOT NULL,
  plex_playlist_id TEXT,
  plex_playlist_title TEXT NOT NULL,
  mode TEXT NOT NULL DEFAULT 'auto_proportional',
  buffer_size INTEGER NOT NULL DEFAULT 30,
  unwatched_only INTEGER NOT NULL DEFAULT 1,
  consecutive_episodes INTEGER NOT NULL DEFAULT 1,
  min_consecutive_episodes INTEGER NOT NULL DEFAULT 1,
  max_consecutive_episodes INTEGER NOT NULL DEFAULT 1,
  enabled INTEGER NOT NULL DEFAULT 1,
  last_synced_at TEXT,
  last_sync_status TEXT,
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE IF NOT EXISTS playlist_shows (
  id TEXT PRIMARY KEY,
  playlist_id TEXT NOT NULL,
  plex_show_rating_key TEXT NOT NULL,
  show_title TEXT NOT NULL,
  show_thumb TEXT,
  season_count INTEGER,
  total_episodes INTEGER,
  unwatched_episodes INTEGER,
  sort_order INTEGER NOT NULL DEFAULT 0,
  manual_weight INTEGER NOT NULL DEFAULT 1,
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  FOREIGN KEY (playlist_id) REFERENCES playlists (id) ON DELETE CASCADE
);

CREATE TABLE IF NOT EXISTS sync_logs (
  id TEXT PRIMARY KEY,
  playlist_id TEXT,
  playlist_name TEXT,
  status TEXT NOT NULL,
  episodes_synced INTEGER NOT NULL DEFAULT 0,
  message TEXT,
  trigger_type TEXT NOT NULL DEFAULT 'manual',
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
);

-- Seed default settings row if missing
INSERT OR IGNORE INTO settings (id, plex_url, plex_token, is_configured, auto_sync_interval_minutes)
VALUES (1, '', '', 0, 30);
`;
