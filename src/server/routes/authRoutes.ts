import { Router } from 'express';
import bcrypt from 'bcryptjs';
import db from '../db/index.js';

const router = Router();

router.get('/status', (req, res) => {
  const settings = db.prepare('SELECT admin_password_hash, is_configured FROM settings WHERE id = 1').get() as any;
  const hasPassword = Boolean(settings?.admin_password_hash);
  const isAuthenticated = Boolean((req as any).session?.isAuthenticated);

  res.json({
    hasPassword,
    isConfigured: Boolean(settings?.is_configured),
    isAuthenticated: !hasPassword || isAuthenticated,
  });
});

router.post('/setup', (req, res) => {
  const { password } = req.body;
  if (!password || password.length < 4) {
    return res.status(400).json({ error: 'Password must be at least 4 characters long.' });
  }

  const salt = bcrypt.genSaltSync(10);
  const hash = bcrypt.hashSync(password, salt);

  db.prepare('UPDATE settings SET admin_password_hash = ?, is_configured = 1, updated_at = CURRENT_TIMESTAMP WHERE id = 1').run(hash);

  (req as any).session.isAuthenticated = true;
  res.json({ success: true, message: 'Password configured successfully.' });
});

router.post('/login', (req, res) => {
  const { password } = req.body;
  const settings = db.prepare('SELECT admin_password_hash FROM settings WHERE id = 1').get() as any;

  if (!settings?.admin_password_hash) {
    (req as any).session.isAuthenticated = true;
    return res.json({ success: true, message: 'No password set.' });
  }

  const isValid = bcrypt.compareSync(password || '', settings.admin_password_hash);
  if (!isValid) {
    return res.status(401).json({ error: 'Invalid password' });
  }

  (req as any).session.isAuthenticated = true;
  res.json({ success: true });
});

router.post('/logout', (req, res) => {
  (req as any).session.destroy(() => {
    res.json({ success: true });
  });
});

export default router;
