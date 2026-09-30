import { Request, Response, NextFunction } from 'express';
import db from '../db/index.js';

export function requireAuth(req: Request, res: Response, next: NextFunction): void {
  const settings = db.prepare('SELECT admin_password_hash, is_configured FROM settings WHERE id = 1').get() as any;

  // If no password set yet, allow initial configuration
  if (!settings || !settings.admin_password_hash) {
    return next();
  }

  // Check session
  const session = (req as any).session;
  if (session && session.isAuthenticated) {
    return next();
  }

  res.status(401).json({ error: 'Unauthorized. Please log in.' });
}
