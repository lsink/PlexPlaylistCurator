import { Router } from 'express';
import db from '../db/index.js';
import { PlexService } from '../plex/plexService.js';
import { updateSyncSchedule } from '../services/syncScheduler.js';
import { requireAuth } from '../middleware/auth.js';

import { APP_VERSION } from '../version.js';

const router = Router();

// Get settings
router.get('/', requireAuth, (req, res) => {
  const settings = db.prepare('SELECT plex_url, plex_token, plex_server_name, is_configured, auto_sync_interval_minutes, webhook_secret FROM settings WHERE id = 1').get() as any;

  // Mask token for client UI
  const rawToken = settings?.plex_token || '';
  const maskedToken = rawToken ? `••••••••${rawToken.slice(-4)}` : '';

  res.json({
    appVersion: APP_VERSION,
    plexUrl: settings?.plex_url || '',
    plexTokenMasked: maskedToken,
    hasToken: Boolean(rawToken),
    plexServerName: settings?.plex_server_name || '',
    isConfigured: Boolean(settings?.is_configured),
    autoSyncIntervalMinutes: settings?.auto_sync_interval_minutes ?? 30,
    hasWebhookSecret: Boolean(settings?.webhook_secret),
  });
});

// Reveal the webhook secret on demand (authenticated) so the UI can build the full webhook URL
router.get('/webhook-secret', requireAuth, (req, res) => {
  const row = db.prepare('SELECT webhook_secret FROM settings WHERE id = 1').get() as any;
  res.json({ secret: row?.webhook_secret || '' });
});

// Update settings
router.post('/', requireAuth, async (req, res) => {
  const { plexUrl, plexToken, autoSyncIntervalMinutes, webhookSecret } = req.body;

  const current = db.prepare('SELECT plex_token FROM settings WHERE id = 1').get() as any;
  // If token is empty or was not modified (empty string passed), keep existing
  const finalToken = plexToken && plexToken.trim() !== '' ? plexToken.trim() : current?.plex_token || '';

  let serverName = '';
  if (plexUrl && finalToken) {
    try {
      const plex = new PlexService(plexUrl, finalToken);
      const info = await plex.testConnection();
      serverName = info.friendlyName;
    } catch {
      // Allow saving even if offline, but don't fail completely
    }
  }

  // The secret travels in a URL query string (Plex can't send headers), so keep it URL-safe
  if (typeof webhookSecret === 'string' && webhookSecret !== '' && !/^[A-Za-z0-9_-]{8,128}$/.test(webhookSecret)) {
    return res.status(400).json({ error: 'Webhook secret must be 8-128 characters: letters, numbers, - and _ only.' });
  }

  const interval = typeof autoSyncIntervalMinutes === 'number' ? autoSyncIntervalMinutes : 30;
  if (!Number.isInteger(interval) || interval < 0 || interval > 1440) {
    return res.status(400).json({ error: 'Auto-sync interval must be a whole number between 0 and 1440 minutes.' });
  }

  db.prepare(
    `UPDATE settings SET 
      plex_url = ?, 
      plex_token = ?, 
      plex_server_name = COALESCE(NULLIF(?, ''), plex_server_name), 
      is_configured = 1, 
      auto_sync_interval_minutes = ?,
      webhook_secret = COALESCE(?, webhook_secret),
      updated_at = CURRENT_TIMESTAMP 
    WHERE id = 1`
  ).run(plexUrl?.trim() || '', finalToken, serverName, interval, typeof webhookSecret === 'string' ? webhookSecret : null);

  // Update background cron
  updateSyncSchedule(interval);

  res.json({ success: true, serverName });
});

// Test connection
router.post('/test-connection', requireAuth, async (req, res) => {
  const { plexUrl, plexToken } = req.body;

  const current = db.prepare('SELECT plex_url, plex_token FROM settings WHERE id = 1').get() as any;
  const targetUrl = plexUrl?.trim() || current?.plex_url;
  const targetToken = plexToken && plexToken.trim() !== '' ? plexToken.trim() : current?.plex_token;

  if (!targetUrl || !targetToken) {
    return res.status(400).json({ error: 'Please enter both Plex URL and Plex Token.' });
  }

  try {
    const plex = new PlexService(targetUrl, targetToken);
    const info = await plex.testConnection();
    const libraries = await plex.getShowLibraries();

    res.json({
      success: true,
      info,
      libraries,
    });
  } catch (err: any) {
    console.error('Plex connection test failed:', err.message);
    res.status(400).json({
      success: false,
      error: err.message || 'Could not connect to Plex Media Server. Check IP, port, and token.',
    });
  }
});

export default router;
