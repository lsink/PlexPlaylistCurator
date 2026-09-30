import { Router } from 'express';
import { randomUUID } from 'crypto';
import db from '../db/index.js';
import { SyncService } from '../services/syncService.js';
import { requireAuth } from '../middleware/auth.js';

const router = Router();

// List all playlists
router.get('/', requireAuth, (req, res) => {
  const playlists = db.prepare('SELECT * FROM playlists ORDER BY created_at DESC').all() as any[];

  const getShowsStmt = db.prepare(
    'SELECT * FROM playlist_shows WHERE playlist_id = ? ORDER BY sort_order ASC'
  );

  const results = playlists.map((p) => ({
    ...p,
    unwatchedOnly: Boolean(p.unwatched_only),
    enabled: Boolean(p.enabled),
    consecutiveEpisodes: p.min_consecutive_episodes || p.consecutive_episodes || 1,
    minConsecutiveEpisodes: p.min_consecutive_episodes || p.consecutive_episodes || 1,
    maxConsecutiveEpisodes: p.max_consecutive_episodes || p.min_consecutive_episodes || p.consecutive_episodes || 1,
    shows: getShowsStmt.all(p.id).map((s: any) => ({
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

  res.json({
    ...playlist,
    unwatchedOnly: Boolean(playlist.unwatched_only),
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
    consecutiveEpisodes,
    minConsecutiveEpisodes,
    maxConsecutiveEpisodes,
    enabled,
    shows,
  } = req.body;

  if (!name || !name.trim()) {
    return res.status(400).json({ error: 'Playlist name is required' });
  }

  const playlistId = randomUUID();
  const title = plexPlaylistTitle?.trim() || name.trim();
  const selectedMode = mode || 'auto_proportional';
  const buffer = typeof bufferSize === 'number' ? bufferSize : 30;
  const isUnwatchedOnly = unwatchedOnly !== false ? 1 : 0;
  const minConsecutive = typeof minConsecutiveEpisodes === 'number' && minConsecutiveEpisodes > 0
    ? minConsecutiveEpisodes
    : (typeof consecutiveEpisodes === 'number' && consecutiveEpisodes > 0 ? consecutiveEpisodes : 1);
  const maxConsecutive = typeof maxConsecutiveEpisodes === 'number' && maxConsecutiveEpisodes > 0
    ? Math.max(minConsecutive, maxConsecutiveEpisodes)
    : minConsecutive;
  const isEnabled = enabled !== false ? 1 : 0;

  const insertPlaylist = db.transaction(() => {
    db.prepare(
      `INSERT INTO playlists (id, name, plex_playlist_title, mode, buffer_size, unwatched_only, consecutive_episodes, min_consecutive_episodes, max_consecutive_episodes, enabled)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
    ).run(playlistId, name.trim(), title, selectedMode, buffer, isUnwatchedOnly, minConsecutive, minConsecutive, maxConsecutive, isEnabled);

    if (Array.isArray(shows)) {
      const insertShowStmt = db.prepare(
        `INSERT INTO playlist_shows (id, playlist_id, plex_show_rating_key, show_title, show_thumb, season_count, total_episodes, unwatched_episodes, sort_order, manual_weight)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
      );

      shows.forEach((show: any, index: number) => {
        insertShowStmt.run(
          randomUUID(),
          playlistId,
          String(show.ratingKey),
          show.title,
          show.thumb || null,
          typeof show.seasonCount === 'number' ? show.seasonCount : null,
          typeof show.totalEpisodes === 'number' ? show.totalEpisodes : null,
          typeof show.unwatchedEpisodes === 'number' ? show.unwatchedEpisodes : null,
          show.sortOrder ?? index,
          typeof show.manualWeight === 'number' && show.manualWeight > 0 ? show.manualWeight : 1
        );
      });
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
      minConsecutive,
      minConsecutive,
      maxConsecutive,
      enabled !== undefined ? (enabled ? 1 : 0) : null,
      playlistId
    );

    if (Array.isArray(shows)) {
      db.prepare('DELETE FROM playlist_shows WHERE playlist_id = ?').run(playlistId);

      const insertShowStmt = db.prepare(
        `INSERT INTO playlist_shows (id, playlist_id, plex_show_rating_key, show_title, show_thumb, season_count, total_episodes, unwatched_episodes, sort_order, manual_weight)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
      );

      shows.forEach((show: any, index: number) => {
        insertShowStmt.run(
          randomUUID(),
          playlistId,
          String(show.ratingKey),
          show.title,
          show.thumb || null,
          typeof show.seasonCount === 'number' ? show.seasonCount : null,
          typeof show.totalEpisodes === 'number' ? show.totalEpisodes : null,
          typeof show.unwatchedEpisodes === 'number' ? show.unwatchedEpisodes : null,
          show.sortOrder ?? index,
          typeof show.manualWeight === 'number' && show.manualWeight > 0 ? show.manualWeight : 1
        );
      });
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

