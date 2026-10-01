import express from 'express';
import cors from 'cors';
import cookieParser from 'cookie-parser';
import session from 'express-session';
import path from 'path';
import fs from 'fs';
import { fileURLToPath } from 'url';
import dotenv from 'dotenv';

import authRoutes from './routes/authRoutes.js';
import settingsRoutes from './routes/settingsRoutes.js';
import plexRoutes from './routes/plexRoutes.js';
import playlistRoutes from './routes/playlistRoutes.js';
import webhookRoutes from './routes/webhookRoutes.js';
import logRoutes from './routes/logRoutes.js';
import { initSyncScheduler } from './services/syncScheduler.js';

import { APP_VERSION } from './version.js';

dotenv.config();

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const app = express();
const PORT = Number(process.env.PORT) || 32500;

// Middleware
app.use(cors());
app.use(express.json({ limit: '10mb' }));
app.use(express.urlencoded({ extended: true, limit: '10mb' }));
app.use(cookieParser());
app.use(
  session({
    secret: process.env.SESSION_SECRET || 'plex-playlist-creator-secret-key-1337',
    resave: false,
    saveUninitialized: false,
    cookie: {
      secure: false, // Set to true if behind HTTPS reverse proxy with trust proxy
      httpOnly: true,
      sameSite: 'lax' as const,
      maxAge: 30 * 24 * 60 * 60 * 1000, // 30 days
    },
  })
);

// Health check & version
app.get('/health', (req, res) => {
  res.json({
    status: 'ok',
    version: APP_VERSION,
    uptime: process.uptime(),
    timestamp: new Date().toISOString(),
  });
});

// API Routes
app.use('/api/auth', authRoutes);
app.use('/api/settings', settingsRoutes);
app.use('/api/plex', plexRoutes);
app.use('/api/playlists', playlistRoutes);
app.use('/api/webhook', webhookRoutes);
app.use('/api/logs', logRoutes);

// Static frontend serving (Production build in dist/public or src/client)
const publicPath = path.resolve(__dirname, '../../dist/public');
const fallbackPublicPath = path.resolve(process.cwd(), 'dist/public');

let staticDir = '';
if (fs.existsSync(publicPath)) {
  staticDir = publicPath;
} else if (fs.existsSync(fallbackPublicPath)) {
  staticDir = fallbackPublicPath;
}

if (staticDir) {
  console.log(`Serving static web dashboard from: ${staticDir}`);
  app.use(express.static(staticDir));

  // SPA fallback
  app.get('*', (req, res) => {
    if (req.path.startsWith('/api') || req.path === '/health') {
      return res.status(404).json({ error: 'Endpoint not found' });
    }
    res.sendFile(path.join(staticDir, 'index.html'));
  });
}

// Global error handler — catches synchronous errors from route handlers
app.use((err: any, req: express.Request, res: express.Response, next: express.NextFunction) => {
  console.error('[Unhandled Error]', err?.message || err);
  if (!res.headersSent) {
    res.status(500).json({ error: 'Internal server error' });
  }
});

// Start Server
app.listen(PORT, '0.0.0.0', () => {
  console.log(`====================================================`);
  console.log(` Plex Playlist Curator (v${APP_VERSION})`);
  console.log(` Server listening at: http://0.0.0.0:${PORT}`);
  console.log(` Health check: http://0.0.0.0:${PORT}/health`);
  console.log(` Webhook URL: http://<YOUR-IP>:${PORT}/api/webhook/plex`);
  console.log(`====================================================`);

  // Initialize automated background sync
  try {
    initSyncScheduler();
  } catch (err) {
    console.error('Failed to initialize sync scheduler:', err);
  }
});
