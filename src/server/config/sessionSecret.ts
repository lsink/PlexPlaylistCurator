import crypto from 'crypto';
import fs from 'fs';
import path from 'path';
import { DATA_DIR } from '../db/index.js';

// Values that were shipped in docker-compose.yml / the README (or hardcoded as the old fallback).
// They are public, so a secret equal to one of them is no secret at all.
const KNOWN_PLACEHOLDERS = new Set([
  'plex-playlist-creator-secret-key-change-me',
  'plex-playlist-creator-secret-key-1337',
  'choose-a-strong-session-secret',
]);

/**
 * Resolve the secret used to sign session cookies:
 *  1. SESSION_SECRET from the environment, unless it is one of the public placeholders
 *  2. otherwise a random secret generated once and kept in DATA_DIR/session-secret (mode 0600),
 *     so it is unique per install and stable across restarts
 */
export function getSessionSecret(): string {
  const fromEnv = process.env.SESSION_SECRET?.trim();
  if (fromEnv && !KNOWN_PLACEHOLDERS.has(fromEnv)) {
    if (fromEnv.length < 16) {
      console.warn('[Security] SESSION_SECRET is shorter than 16 characters; consider a longer random value.');
    }
    return fromEnv;
  }
  if (fromEnv) {
    console.warn(
      '[Security] SESSION_SECRET is set to a publicly known placeholder value and is being ignored. ' +
        'Using a generated per-install secret instead (set your own SESSION_SECRET to override).'
    );
  }

  const secretPath = path.join(DATA_DIR, 'session-secret');
  try {
    const existing = fs.readFileSync(secretPath, 'utf8').trim();
    if (existing.length >= 32) return existing;
  } catch {
    // Not created yet
  }

  const generated = crypto.randomBytes(48).toString('hex');
  try {
    fs.writeFileSync(secretPath, generated, { mode: 0o600 });
  } catch (err) {
    console.error('[Security] Could not persist the generated session secret; sessions will reset on restart:', err);
  }
  return generated;
}
