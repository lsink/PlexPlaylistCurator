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

// POST /setup — allowed if no password is set yet, or if the caller is already logged in
// (the Settings modal uses this to change the password from an authenticated session)
router.post('/setup', async (req, res) => {
  const existing = db.prepare('SELECT admin_password_hash FROM settings WHERE id = 1').get() as any;
  if (existing?.admin_password_hash && !(req as any).session?.isAuthenticated) {
    return res.status(403).json({ error: 'Password already configured. Log in to change it.' });
  }

  const { password } = req.body;
  if (!password || password.length < 8) {
    return res.status(400).json({ error: 'Password must be at least 8 characters long.' });
  }

  const salt = await bcrypt.genSalt(12);
  const hash = await bcrypt.hash(password, salt);

  db.prepare('UPDATE settings SET admin_password_hash = ?, is_configured = 1, updated_at = CURRENT_TIMESTAMP WHERE id = 1').run(hash);

  (req as any).session.isAuthenticated = true;
  res.json({ success: true, message: 'Password configured successfully.' });
});

// POST /change-password — requires old password
router.post('/change-password', async (req, res) => {
  const { currentPassword, newPassword } = req.body;
  if (!newPassword || newPassword.length < 8) {
    return res.status(400).json({ error: 'New password must be at least 8 characters long.' });
  }

  const settings = db.prepare('SELECT admin_password_hash FROM settings WHERE id = 1').get() as any;
  if (!settings?.admin_password_hash) {
    return res.status(400).json({ error: 'No password is currently set. Use /setup instead.' });
  }

  const isValid = await bcrypt.compare(currentPassword || '', settings.admin_password_hash);
  if (!isValid) {
    return res.status(401).json({ error: 'Current password is incorrect.' });
  }

  const salt = await bcrypt.genSalt(12);
  const hash = await bcrypt.hash(newPassword, salt);
  db.prepare('UPDATE settings SET admin_password_hash = ?, updated_at = CURRENT_TIMESTAMP WHERE id = 1').run(hash);

  res.json({ success: true, message: 'Password changed successfully.' });
});

router.post('/login', async (req, res) => {
  const { password } = req.body;
  const settings = db.prepare('SELECT admin_password_hash FROM settings WHERE id = 1').get() as any;

  if (!settings?.admin_password_hash) {
    (req as any).session.isAuthenticated = true;
    return res.json({ success: true, message: 'No password set.' });
  }

  const isValid = await bcrypt.compare(password || '', settings.admin_password_hash);
  if (!isValid) {
    return res.status(401).json({ error: 'Invalid password' });
  }

  (req as any).session.isAuthenticated = true;
  res.json({ success: true });
});

router.post('/logout', (req, res) => {
  (req as any).session.destroy((err: any) => {
    if (err) {
      console.error('Session destroy error:', err);
    }
    res.json({ success: true });
  });
});

export default router;
