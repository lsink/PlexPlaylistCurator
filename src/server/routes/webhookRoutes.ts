import { Router } from 'express';
import { timingSafeEqual } from 'crypto';
import { SyncService } from '../services/syncService.js';
import db from '../db/index.js';

const router = Router();

router.post('/plex', async (req, res) => {
  try {
    // Optional webhook secret validation — check BEFORE parsing payload
    const settings = db.prepare('SELECT webhook_secret FROM settings WHERE id = 1').get() as any;
    if (settings?.webhook_secret) {
      // Plex webhooks can't send custom headers, so also accept ?secret= in the URL
      const secretHeader = String(req.headers['x-webhook-secret'] || req.query.secret || '');
      let valid = false;
      try {
        const a = Buffer.from(secretHeader);
        const b = Buffer.from(settings.webhook_secret);
        valid = a.length === b.length && timingSafeEqual(a, b);
      } catch {
        valid = false;
      }
      if (!valid) {
        return res.status(401).json({ error: 'Invalid webhook secret' });
      }
    }

    let payload = req.body;

    // If Plex sent multipart or URL encoded with a 'payload' JSON string
    if (typeof payload?.payload === 'string') {
      try {
        payload = JSON.parse(payload.payload);
      } catch (e) {
        console.error('Failed to parse Plex webhook payload JSON string:', e);
      }
    }

    // Process asynchronously so Plex gets an immediate 200 OK
    res.status(200).json({ received: true });

    SyncService.handleWebhook(payload).catch((err) => {
      console.error('Error handling webhook in background:', err);
    });
  } catch (err: any) {
    console.error('Webhook error:', err);
    if (!res.headersSent) {
      res.status(500).json({ error: 'Webhook processing failed' });
    }
  }
});

export default router;
