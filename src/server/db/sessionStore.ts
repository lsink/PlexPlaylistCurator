import session from 'express-session';
import db from './index.js';

const DEFAULT_TTL_MS = 30 * 24 * 60 * 60 * 1000;

/**
 * express-session store backed by the app's SQLite database, so logins survive restarts
 * (the default MemoryStore forgets everyone on every restart and leaks memory over time).
 */
export class SqliteSessionStore extends session.Store {
  private getStmt = db.prepare('SELECT sess FROM sessions WHERE sid = ? AND expires > ?');
  private setStmt = db.prepare(
    'INSERT INTO sessions (sid, sess, expires) VALUES (?, ?, ?) ON CONFLICT(sid) DO UPDATE SET sess = excluded.sess, expires = excluded.expires'
  );
  private deleteStmt = db.prepare('DELETE FROM sessions WHERE sid = ?');
  private touchStmt = db.prepare('UPDATE sessions SET expires = ? WHERE sid = ?');
  private pruneStmt = db.prepare('DELETE FROM sessions WHERE expires <= ?');

  constructor() {
    super();
    this.prune();
    const timer = setInterval(() => this.prune(), 60 * 60 * 1000);
    timer.unref();
  }

  private expiryOf(sess: session.SessionData): number {
    const expires = sess.cookie?.expires;
    return expires ? new Date(expires).getTime() : Date.now() + DEFAULT_TTL_MS;
  }

  private prune() {
    try {
      this.pruneStmt.run(Date.now());
    } catch (err) {
      console.error('Failed to prune expired sessions:', err);
    }
  }

  get(sid: string, callback: (err: any, session?: session.SessionData | null) => void): void {
    try {
      const row = this.getStmt.get(sid, Date.now()) as { sess: string } | undefined;
      callback(null, row ? JSON.parse(row.sess) : null);
    } catch (err) {
      callback(err);
    }
  }

  set(sid: string, sess: session.SessionData, callback?: (err?: any) => void): void {
    try {
      this.setStmt.run(sid, JSON.stringify(sess), this.expiryOf(sess));
      callback?.();
    } catch (err) {
      callback?.(err);
    }
  }

  destroy(sid: string, callback?: (err?: any) => void): void {
    try {
      this.deleteStmt.run(sid);
      callback?.();
    } catch (err) {
      callback?.(err);
    }
  }

  touch(sid: string, sess: session.SessionData, callback?: () => void): void {
    try {
      this.touchStmt.run(this.expiryOf(sess), sid);
    } catch (err) {
      console.error('Failed to touch session:', err);
    }
    callback?.();
  }
}
