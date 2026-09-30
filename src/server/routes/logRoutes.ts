import { Router } from 'express';
import db from '../db/index.js';
import { requireAuth } from '../middleware/auth.js';

const router = Router();

// Get sync logs
router.get('/', requireAuth, (req, res) => {
  const limit = Math.min(Number(req.query.limit) || 50, 100);
  const logs = db
    .prepare('SELECT * FROM sync_logs ORDER BY created_at DESC LIMIT ?')
    .all(limit);

  res.json(logs);
});

// Clear sync logs
router.delete('/', requireAuth, (req, res) => {
  db.prepare('DELETE FROM sync_logs').run();
  res.json({ success: true });
});

export default router;
