import { Router } from 'express';
import { SyncService } from '../services/syncService.js';
import { requireAuth } from '../middleware/auth.js';

const router = Router();

// Lightweight connection health check (used by the navbar status dot)
router.get('/status', requireAuth, async (req, res) => {
  try {
    const plex = SyncService.getPlexService();
    const info = await plex.testConnection();
    res.json({ connected: true, serverName: info.friendlyName });
  } catch (err: any) {
    res.json({ connected: false, error: err.message || 'Plex unreachable' });
  }
});

// Get TV Show libraries
router.get('/libraries', requireAuth, async (req, res) => {
  try {
    const plex = SyncService.getPlexService();
    const libraries = await plex.getShowLibraries();
    res.json(libraries);
  } catch (err: any) {
    res.status(500).json({ error: err.message || 'Failed to fetch TV libraries' });
  }
});

// Get shows in a library section
router.get('/shows', requireAuth, async (req, res) => {
  const sectionKey = req.query.sectionKey as string;
  if (!sectionKey) {
    return res.status(400).json({ error: 'sectionKey query parameter is required' });
  }

  try {
    const plex = SyncService.getPlexService();
    const shows = await plex.getShows(sectionKey);
    res.json(shows);
  } catch (err: any) {
    res.status(500).json({ error: err.message || 'Failed to fetch shows' });
  }
});

// Search shows across libraries
router.get('/search', requireAuth, async (req, res) => {
  const query = (req.query.q as string) || '';
  if (!query.trim()) {
    return res.json([]);
  }

  try {
    const plex = SyncService.getPlexService();
    const results = await plex.searchShows(query.trim());
    res.json(results);
  } catch (err: any) {
    res.status(500).json({ error: err.message || 'Search failed' });
  }
});

// Mark show as unwatched
router.post('/unscrobble', requireAuth, async (req, res) => {
  const { showRatingKey } = req.body;
  if (!showRatingKey) {
    return res.status(400).json({ error: 'showRatingKey is required' });
  }

  try {
    const plex = SyncService.getPlexService();
    await plex.markShowUnwatched(showRatingKey);
    res.json({ success: true, message: 'Show marked as unwatched in Plex.' });
  } catch (err: any) {
    res.status(500).json({ error: err.message || 'Failed to unscrobble show' });
  }
});

// Get individual show metadata (unwatched count, episodes, seasons, thumb)
router.get('/shows/:ratingKey', requireAuth, async (req, res) => {
  const ratingKey = String(req.params.ratingKey);
  try {
    const plex = SyncService.getPlexService();
    const show = await plex.getShowMetadata(ratingKey);
    if (!show) {
      return res.status(404).json({ error: 'Show not found' });
    }
    res.json(show);
  } catch (err: any) {
    res.status(500).json({ error: err.message || 'Failed to fetch show metadata' });
  }
});

// Proxy image from Plex Media Server
router.get('/image', requireAuth, async (req, res) => {
  const imagePath = req.query.path as string;
  if (!imagePath) {
    return res.status(400).send('Image path is required');
  }

  // Security: only allow relative Plex paths starting with /
  // Block absolute URLs, protocol-relative URLs, and path traversal
  if (!imagePath.startsWith('/') || imagePath.startsWith('//') || imagePath.includes('://') || imagePath.includes('..')) {
    return res.status(400).send('Invalid image path');
  }

  try {
    const plex = SyncService.getPlexService();
    const { data, contentType } = await plex.getImageStream(imagePath);
    res.setHeader('Content-Type', contentType);
    res.setHeader('Cache-Control', 'public, max-age=86400');
    data.pipe(res);
  } catch (err: any) {
    res.status(404).send('Image not found');
  }
});

export default router;

