import { Router } from 'express';
import { randomUUID } from 'crypto';
import db from '../db/index.js';
import { SyncService } from '../services/syncService.js';
import { requireAuth } from '../middleware/auth.js';

const router = Router();

/** Another app playlist already syncs to a Plex playlist with this title (case-insensitive)? */
function findTitleConflict(title: string, excludeId?: string): { name: string } | undefined {
  return db
    .prepare('SELECT name FROM playlists WHERE LOWER(plex_playlist_title) = LOWER(?) AND id != ?')
    .get(title, excludeId ?? '') as { name: string } | undefined;
}

const VALID_MODES = ['round_robin', 'auto_proportional', 'manual_weighted', 'chronological', 'runtime_balanced'];

/** Shared by create and update: replace playlist_shows with a diff so existing rows keep their IDs */
function syncPlaylistShows(playlistId: string, shows: any[]) {
  const existingRows = db
    .prepare('SELECT id, plex_show_rating_key FROM playlist_shows WHERE playlist_id = ?')
    .all(playlistId) as { id: string; plex_show_rating_key: string }[];
  const existingByKey = new Map(existingRows.map((r) => [r.plex_show_rating_key, r.id]));

  const seen = new Set<string>();
  const incoming = shows.filter((show: any) => {
    const key = String(show.ratingKey);
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });

  const deleteStmt = db.prepare('DELETE FROM playlist_shows WHERE id = ?');
  for (const row of existingRows) {
    if (!seen.has(row.plex_show_rating_key)) deleteStmt.run(row.id);
  }

  const insertStmt = db.prepare(
    `INSERT INTO playlist_shows (id, playlist_id, plex_show_rating_key, show_title, show_thumb, season_count, total_episodes, unwatched_episodes, sort_order, manual_weight)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
  );
  const updateStmt = db.prepare(
    `UPDATE playlist_shows SET show_title = ?, show_thumb = ?, season_count = ?, total_episodes = ?, unwatched_episodes = ?, sort_order = ?, manual_weight = ? WHERE id = ?`
  );

  incoming.forEach((show: any, index: number) => {
    const key = String(show.ratingKey);
    const values = [
      show.title,
      show.thumb || null,
      typeof show.seasonCount === 'number' ? show.seasonCount : null,
      typeof show.totalEpisodes === 'number' ? show.totalEpisodes : null,
      typeof show.unwatchedEpisodes === 'number' ? show.unwatchedEpisodes : null,
      show.sortOrder ?? index,
      typeof show.manualWeight === 'number' && show.manualWeight > 0 ? show.manualWeight : 1,
    ];
    const existingId = existingByKey.get(key);
    if (existingId) {
      updateStmt.run(...values, existingId);
    } else {
      insertStmt.run(randomUUID(), playlistId, key, ...values);
    }
  });
}

// List all playlists
router.get('/', requireAuth, (req, res) => {
  const playlists = db.prepare('SELECT * FROM playlists ORDER BY created_at DESC, rowid DESC').all() as any[];

  const allShows = db
    .prepare('SELECT * FROM playlist_shows ORDER BY sort_order ASC')
    .all() as any[];
  const showsByPlaylist = new Map<string, any[]>();
  for (const s of allShows) {
    const list = showsByPlaylist.get(s.playlist_id);
    if (list) list.push(s);
    else showsByPlaylist.set(s.playlist_id, [s]);
  }

  const results = playlists.map(({ last_synced_queue, schedule_state, schedule_config, ...p }) => ({
    ...p,
    unwatchedOnly: Boolean(p.unwatched_only),
    includeSpecials: Boolean(p.include_specials),
    enabled: Boolean(p.enabled),
    consecutiveEpisodes: p.min_consecutive_episodes || p.consecutive_episodes || 1,
    minConsecutiveEpisodes: p.min_consecutive_episodes || p.consecutive_episodes || 1,
    maxConsecutiveEpisodes: p.max_consecutive_episodes || p.min_consecutive_episodes || p.consecutive_episodes || 1,
    shows: (showsByPlaylist.get(p.id) || []).map((s: any) => ({
      id: s.id,
      ratingKey: s.plex_show_rating_key,
      title: s.show_title,
      thumb: s.show_thumb,
      seasonCount: s.season_count,
      totalEpisodes: s.total_episodes,
      unwatchedEpisodes: s.unwatched_episodes,
      sortOrder: s.sort_order,
      manualWeight: s.manual_weight,
    })),
  }));

  res.json(results);
});

// Sync all enabled playlists in parallel (server-side)
router.post('/sync-all', requireAuth, async (req, res) => {
  try {
    const result = await SyncService.syncAllPlaylists('manual');
    res.json({ success: true, ...result });
  } catch (err: any) {
    res.status(500).json({ error: err.message || 'Sync failed' });
  }
});

// Export all playlist configs as JSON (backup)
router.get('/export', requireAuth, (req, res) => {
  const playlists = db.prepare('SELECT * FROM playlists ORDER BY created_at ASC').all() as any[];
  const shows = db.prepare('SELECT * FROM playlist_shows ORDER BY sort_order ASC').all() as any[];
  const data = playlists.map((p) => ({
    name: p.name,
    plexPlaylistTitle: p.plex_playlist_title,
    mode: p.mode,
    bufferSize: p.buffer_size,
    unwatchedOnly: Boolean(p.unwatched_only),
    includeSpecials: Boolean(p.include_specials),
    minConsecutiveEpisodes: p.min_consecutive_episodes || p.consecutive_episodes || 1,
    maxConsecutiveEpisodes: p.max_consecutive_episodes || p.min_consecutive_episodes || 1,
    enabled: Boolean(p.enabled),
    shows: shows
      .filter((s) => s.playlist_id === p.id)
      .map((s) => ({
        ratingKey: s.plex_show_rating_key,
        title: s.show_title,
        thumb: s.show_thumb,
        seasonCount: s.season_count,
        totalEpisodes: s.total_episodes,
        unwatchedEpisodes: s.unwatched_episodes,
        sortOrder: s.sort_order,
        manualWeight: s.manual_weight,
      })),
  }));
  res.json({ version: 1, exportedAt: new Date().toISOString(), playlists: data });
});

// Import playlist configs from an export (always creates new playlists)
router.post('/import', requireAuth, (req, res) => {
  const list = req.body?.playlists;
  if (!Array.isArray(list)) {
    return res.status(400).json({ error: 'Invalid import file: "playlists" array is missing.' });
  }

  const importTx = db.transaction(() => {
    for (const p of list) {
      if (!p?.name || typeof p.name !== 'string') throw new Error('Each playlist needs a name.');
      const mode = VALID_MODES.includes(p.mode) ? p.mode : 'auto_proportional';
      const min = typeof p.minConsecutiveEpisodes === 'number' && p.minConsecutiveEpisodes > 0 ? p.minConsecutiveEpisodes : 1;
      const max = typeof p.maxConsecutiveEpisodes === 'number' && p.maxConsecutiveEpisodes >= min ? p.maxConsecutiveEpisodes : min;
      const id = randomUUID();
      // Keep Plex titles unique: restoring onto an install that already has this playlist adds " (2)", " (3)", ...
      const baseTitle = (p.plexPlaylistTitle || p.name).trim();
      let importTitle = baseTitle;
      for (let n = 2; findTitleConflict(importTitle); n++) importTitle = `${baseTitle} (${n})`;
      db.prepare(
        `INSERT INTO playlists (id, name, plex_playlist_title, mode, buffer_size, unwatched_only, include_specials, consecutive_episodes, min_consecutive_episodes, max_consecutive_episodes, enabled)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
      ).run(
        id,
        p.name.trim(),
        importTitle,
        mode,
        typeof p.bufferSize === 'number' ? p.bufferSize : 30,
        p.unwatchedOnly === false ? 0 : 1,
        p.includeSpecials === false ? 0 : 1,
        min,
        min,
        max,
        p.enabled === false ? 0 : 1
      );
      if (Array.isArray(p.shows)) syncPlaylistShows(id, p.shows.filter((s: any) => s?.ratingKey && s?.title));
    }
  });

  try {
    importTx();
    res.json({ success: true, imported: list.length });
  } catch (err: any) {
    res.status(400).json({ error: err.message || 'Import failed' });
  }
});

// Get single playlist
router.get('/:id', requireAuth, (req, res) => {
  const playlistId = String(req.params.id);
  const playlist = db.prepare('SELECT * FROM playlists WHERE id = ?').get(playlistId) as any;
  if (!playlist) {
    return res.status(404).json({ error: 'Playlist not found' });
  }

  const shows = db
    .prepare('SELECT * FROM playlist_shows WHERE playlist_id = ? ORDER BY sort_order ASC')
    .all(playlist.id)
    .map((s: any) => ({
      id: s.id,
      ratingKey: s.plex_show_rating_key,
      title: s.show_title,
      thumb: s.show_thumb,
      seasonCount: s.season_count,
      totalEpisodes: s.total_episodes,
      unwatchedEpisodes: s.unwatched_episodes,
      sortOrder: s.sort_order,
      manualWeight: s.manual_weight,
    }));

  const { last_synced_queue, schedule_state, schedule_config, ...playlistFields } = playlist;
  res.json({
    ...playlistFields,
    unwatchedOnly: Boolean(playlist.unwatched_only),
    includeSpecials: Boolean(playlist.include_specials),
    enabled: Boolean(playlist.enabled),
    consecutiveEpisodes: playlist.min_consecutive_episodes || playlist.consecutive_episodes || 1,
    minConsecutiveEpisodes: playlist.min_consecutive_episodes || playlist.consecutive_episodes || 1,
    maxConsecutiveEpisodes: playlist.max_consecutive_episodes || playlist.min_consecutive_episodes || playlist.consecutive_episodes || 1,
    shows,
  });
});

// Create new playlist
router.post('/', requireAuth, async (req, res) => {
  const {
    name,
    plexPlaylistTitle,
    mode,
    bufferSize,
    unwatchedOnly,
    includeSpecials,
    consecutiveEpisodes,
    minConsecutiveEpisodes,
    maxConsecutiveEpisodes,
    enabled,
    shows,
  } = req.body;

  if (!name || !name.trim()) {
    return res.status(400).json({ error: 'Playlist name is required' });
  }

  if (mode !== undefined && !VALID_MODES.includes(mode)) {
    return res.status(400).json({ error: `Invalid mode. Must be one of: ${VALID_MODES.join(', ')}` });
  }

  const playlistId = randomUUID();
  const title = plexPlaylistTitle?.trim() || name.trim();

  const conflict = findTitleConflict(title);
  if (conflict) {
    return res.status(409).json({
      error: `The playlist "${conflict.name}" already uses the Plex title "${title}". Each playlist needs its own Plex title.`,
    });
  }
  const selectedMode = mode || 'auto_proportional';
  const buffer = typeof bufferSize === 'number' ? bufferSize : 30;
  const isUnwatchedOnly = unwatchedOnly !== false ? 1 : 0;
  const specials = includeSpecials === true ? 1 : 0;
  const minConsecutive = typeof minConsecutiveEpisodes === 'number' && minConsecutiveEpisodes > 0
    ? minConsecutiveEpisodes
    : (typeof consecutiveEpisodes === 'number' && consecutiveEpisodes > 0 ? consecutiveEpisodes : 1);
  const maxConsecutive = typeof maxConsecutiveEpisodes === 'number' && maxConsecutiveEpisodes > 0
    ? Math.max(minConsecutive, maxConsecutiveEpisodes)
    : minConsecutive;
  const isEnabled = enabled !== false ? 1 : 0;

  const insertPlaylist = db.transaction(() => {
    db.prepare(
      `INSERT INTO playlists (id, name, plex_playlist_title, mode, buffer_size, unwatched_only, include_specials, consecutive_episodes, min_consecutive_episodes, max_consecutive_episodes, enabled)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
    ).run(playlistId, name.trim(), title, selectedMode, buffer, isUnwatchedOnly, specials, minConsecutive, minConsecutive, maxConsecutive, isEnabled);

    if (Array.isArray(shows)) {
      syncPlaylistShows(playlistId, shows);
    }
  });

  try {
    insertPlaylist();
    res.status(201).json({ id: playlistId, success: true });
  } catch (err: any) {
    res.status(500).json({ error: err.message || 'Failed to create playlist' });
  }
});

// Update playlist
router.put('/:id', requireAuth, async (req, res) => {
  const playlistId = String(req.params.id);
  const {
    name,
    plexPlaylistTitle,
    mode,
    bufferSize,
    unwatchedOnly,
    includeSpecials,
    consecutiveEpisodes,
    minConsecutiveEpisodes,
    maxConsecutiveEpisodes,
    enabled,
    shows,
  } = req.body;

  const existing = db.prepare('SELECT id FROM playlists WHERE id = ?').get(playlistId);
  if (!existing) {
    return res.status(404).json({ error: 'Playlist not found' });
  }
  if (mode !== undefined && !VALID_MODES.includes(mode)) {
    return res.status(400).json({ error: `Invalid mode. Must be one of: ${VALID_MODES.join(', ')}` });
  }

  const newTitle = plexPlaylistTitle?.trim();
  if (newTitle) {
    const conflict = findTitleConflict(newTitle, playlistId);
    if (conflict) {
      return res.status(409).json({
        error: `The playlist "${conflict.name}" already uses the Plex title "${newTitle}". Each playlist needs its own Plex title.`,
      });
    }
  }

  const minConsecutive = typeof minConsecutiveEpisodes === 'number' && minConsecutiveEpisodes > 0
    ? minConsecutiveEpisodes
    : (typeof consecutiveEpisodes === 'number' && consecutiveEpisodes > 0 ? consecutiveEpisodes : undefined);
  const maxConsecutive = typeof maxConsecutiveEpisodes === 'number' && maxConsecutiveEpisodes > 0
    ? maxConsecutiveEpisodes
    : (minConsecutive !== undefined ? minConsecutive : undefined);

  const updateTx = db.transaction(() => {
    db.prepare(
      `UPDATE playlists SET
        name = COALESCE(?, name),
        plex_playlist_title = COALESCE(?, plex_playlist_title),
        mode = COALESCE(?, mode),
        buffer_size = COALESCE(?, buffer_size),
        unwatched_only = COALESCE(?, unwatched_only),
        include_specials = COALESCE(?, include_specials),
        consecutive_episodes = COALESCE(?, consecutive_episodes),
        min_consecutive_episodes = COALESCE(?, min_consecutive_episodes),
        max_consecutive_episodes = COALESCE(?, max_consecutive_episodes),
        enabled = COALESCE(?, enabled),
        updated_at = CURRENT_TIMESTAMP
       WHERE id = ?`
    ).run(
      name?.trim(),
      plexPlaylistTitle?.trim(),
      mode,
      bufferSize,
      unwatchedOnly !== undefined ? (unwatchedOnly ? 1 : 0) : null,
      includeSpecials !== undefined ? (includeSpecials ? 1 : 0) : null,
      minConsecutive,
      minConsecutive,
      maxConsecutive,
      enabled !== undefined ? (enabled ? 1 : 0) : null,
      playlistId
    );

    if (Array.isArray(shows)) {
      syncPlaylistShows(playlistId, shows);
    }
  });

  try {
    updateTx();
    res.json({ success: true });
  } catch (err: any) {
    res.status(500).json({ error: err.message || 'Failed to update playlist' });
  }
});

// Delete playlist
router.delete('/:id', requireAuth, async (req, res) => {
  const playlistId = String(req.params.id);
  const deleteFromPlex = req.query.deleteFromPlex === 'true';

  const playlist = db.prepare('SELECT plex_playlist_id FROM playlists WHERE id = ?').get(playlistId) as any;
  if (!playlist) {
    return res.status(404).json({ error: 'Playlist not found' });
  }

  if (deleteFromPlex && playlist.plex_playlist_id) {
    try {
      const plex = SyncService.getPlexService();
      await plex.deletePlaylist(playlist.plex_playlist_id);
    } catch (err) {
      console.error('Failed to delete playlist from Plex:', err);
    }
  }

  db.prepare('DELETE FROM playlists WHERE id = ?').run(playlistId);
  res.json({ success: true });
});

// Preview calculated queue
router.get('/:id/preview', requireAuth, async (req, res) => {
  try {
    const playlistId = String(req.params.id);
    const preview = await SyncService.previewQueue(playlistId);
    res.json(preview);
  } catch (err: any) {
    res.status(500).json({ error: err.message || 'Failed to generate preview' });
  }
});

// Trigger manual sync to Plex
router.post('/:id/sync', requireAuth, async (req, res) => {
  try {
    const playlistId = String(req.params.id);
    const result = await SyncService.syncPlaylistById(playlistId, 'manual');
    res.json({ success: true, ...result });
  } catch (err: any) {
    res.status(500).json({ error: err.message || 'Sync failed' });
  }
});

// Refresh show stats from Plex
router.post('/:id/refresh-stats', requireAuth, async (req, res) => {
  try {
    const playlistId = String(req.params.id);
    const shows = await SyncService.refreshPlaylistShowStats(playlistId);
    res.json({ success: true, shows });
  } catch (err: any) {
    res.status(500).json({ error: err.message || 'Failed to refresh show stats' });
  }
});

export default router;

