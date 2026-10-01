import { Router } from 'express';
import bcrypt from 'bcryptjs';
import db from '../db/index.js';

const router = Router();

// Simple in-memory brute-force protection: max failed attempts per IP per window
const MAX_FAILED_LOGINS = 5;
const LOGIN_WINDOW_MS = 15 * 60 * 1000;
const failedLogins = new Map<string, { count: number; resetAt: number }>();

function loginBlockedSeconds(ip: string): number {
  const entry = failedLogins.get(ip);
  if (!entry) return 0;
  if (entry.resetAt <= Date.now()) {
    failedLogins.delete(ip);
    return 0;
  }
  return entry.count >= MAX_FAILED_LOGINS ? Math.ceil((entry.resetAt - Date.now()) / 1000) : 0;
}

function recordFailedLogin(ip: string) {
  const now = Date.now();
  const entry = failedLogins.get(ip);
  if (!entry || entry.resetAt <= now) {
    failedLogins.set(ip, { count: 1, resetAt: now + LOGIN_WINDOW_MS });
  } else {
    entry.count++;
  }
}

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
  const ip = req.ip || req.socket.remoteAddress || 'unknown';
  const blockedFor = loginBlockedSeconds(ip);
  if (blockedFor > 0) {
    res.setHeader('Retry-After', String(blockedFor));
    return res.status(429).json({ error: `Too many failed attempts. Try again in ${Math.ceil(blockedFor / 60)} minute(s).` });
  }

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
    recordFailedLogin(ip);
    return res.status(401).json({ error: 'Current password is incorrect.' });
  }
  failedLogins.delete(ip);

  const salt = await bcrypt.genSalt(12);
  const hash = await bcrypt.hash(newPassword, salt);
  db.prepare('UPDATE settings SET admin_password_hash = ?, updated_at = CURRENT_TIMESTAMP WHERE id = 1').run(hash);

  res.json({ success: true, message: 'Password changed successfully.' });
});

router.post('/login', async (req, res) => {
  const ip = req.ip || req.socket.remoteAddress || 'unknown';
  const blockedFor = loginBlockedSeconds(ip);
  if (blockedFor > 0) {
    res.setHeader('Retry-After', String(blockedFor));
    return res.status(429).json({ error: `Too many failed attempts. Try again in ${Math.ceil(blockedFor / 60)} minute(s).` });
  }

  const { password } = req.body;
  const settings = db.prepare('SELECT admin_password_hash FROM settings WHERE id = 1').get() as any;

  if (!settings?.admin_password_hash) {
    (req as any).session.isAuthenticated = true;
    return res.json({ success: true, message: 'No password set.' });
  }

  const isValid = await bcrypt.compare(password || '', settings.admin_password_hash);
  if (!isValid) {
    recordFailedLogin(ip);
    return res.status(401).json({ error: 'Invalid password' });
  }

  failedLogins.delete(ip);
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
