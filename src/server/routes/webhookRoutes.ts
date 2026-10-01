import { Router, Request, Response, NextFunction } from 'express';
import multer from 'multer';
import { timingSafeEqual } from 'crypto';
import { SyncService } from '../services/syncService.js';
import db from '../db/index.js';

const router = Router();

// Plex sends webhooks as multipart/form-data (a "payload" JSON field, plus an optional thumbnail file).
// Memory storage with tight limits: the thumbnail is never used, so it is simply discarded.
const multipartParser = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: 2 * 1024 * 1024, files: 2, fields: 10, parts: 12 },
}).any();

/** Reject bad secrets BEFORE parsing the body, so unauthenticated callers can't make us buffer uploads */
function checkWebhookSecret(req: Request, res: Response, next: NextFunction) {
  const settings = db.prepare('SELECT webhook_secret FROM settings WHERE id = 1').get() as any;
  if (!settings?.webhook_secret) return next();

  // Plex webhooks can't send custom headers, so also accept ?secret= in the URL
  const provided = String(req.headers['x-webhook-secret'] || req.query.secret || '');
  const a = Buffer.from(provided);
  const b = Buffer.from(settings.webhook_secret);
  const valid = a.length === b.length && timingSafeEqual(a, b);
  if (!valid) {
    const from = req.ip || req.socket.remoteAddress || 'unknown address';
    console.warn(`[Webhook] rejected: invalid or missing secret (from ${from})`);
    SyncService.recordWebhookEvent({ outcome: 'rejected', detail: `Invalid or missing webhook secret (from ${from})` });
    return res.status(401).json({ error: 'Invalid webhook secret' });
  }
  next();
}

function parseMultipartIfNeeded(req: Request, res: Response, next: NextFunction) {
  if (!req.is('multipart/form-data')) return next();
  multipartParser(req, res, (err: any) => {
    if (err) {
      console.error('Failed to parse multipart webhook:', err?.message || err);
      SyncService.recordWebhookEvent({ outcome: 'invalid', detail: `Could not read multipart body: ${err?.message || err}` });
      return res.status(400).json({ error: 'Invalid multipart payload' });
    }
    next();
  });
}

router.post('/plex', checkWebhookSecret, parseMultipartIfNeeded, async (req, res) => {
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

// Anything other than POST (e.g. someone opening the URL in a browser to test it) gets a clear explanation
// instead of the generic "Endpoint not found". Deliberately independent of the webhook secret.
router.all('/plex', (req, res) => {
  res.setHeader('Allow', 'POST');
  res.status(405).json({
    error: 'Method not allowed',
    message:
      'This is the Plex webhook endpoint. It only accepts POST requests, which Plex sends automatically when ' +
      'an episode finishes playing, so opening it in a browser will not do anything. ' +
      'The endpoint is reachable. Check the Sync History in the dashboard to see webhook activity.',
  });
});

export default router;
