import { Router } from 'express';
import { SyncService } from '../services/syncService.js';
import db from '../db/index.js';

const router = Router();

router.post('/plex', async (req, res) => {
  try {
    let payload = req.body;

    // If Plex sent multipart or URL encoded with a 'payload' JSON string
    if (typeof payload?.payload === 'string') {
      try {
        payload = JSON.parse(payload.payload);
      } catch (e) {
        console.error('Failed to parse Plex webhook payload JSON string:', e);
      }
    }

    // Optional webhook secret validation if configured
    const settings = db.prepare('SELECT webhook_secret FROM settings WHERE id = 1').get() as any;
    if (settings?.webhook_secret) {
      const secretHeader = req.headers['x-webhook-secret'] || req.query.secret;
      if (secretHeader !== settings.webhook_secret) {
        return res.status(401).json({ error: 'Invalid webhook secret' });
      }
    }

    // Process asynchronously so Plex gets an immediate 200 OK
    res.status(200).json({ received: true });

    SyncService.handleWebhook(payload).catch((err) => {
      console.error('Error handling webhook in background:', err);
    });
  } catch (err: any) {
    console.error('Webhook error:', err);
    res.status(500).json({ error: 'Webhook processing failed' });
  }
});

export default router;
