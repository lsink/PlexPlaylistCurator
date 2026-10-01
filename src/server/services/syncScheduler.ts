import db from '../db/index.js';
import { SyncService } from './syncService.js';

let currentTimer: ReturnType<typeof setInterval> | null = null;

export function initSyncScheduler() {
  const settings = db.prepare('SELECT auto_sync_interval_minutes FROM settings WHERE id = 1').get() as any;
  const interval = settings?.auto_sync_interval_minutes ?? 30;
  scheduleSync(interval);
}

export function updateSyncSchedule(intervalMinutes: number) {
  if (currentTimer) {
    clearInterval(currentTimer);
    currentTimer = null;
  }
  scheduleSync(intervalMinutes);
}

function scheduleSync(intervalMinutes: number) {
  // If interval is 0 or negative, disable periodic sync
  if (intervalMinutes <= 0) {
    console.log('Automated periodic sync is disabled.');
    return;
  }

  const intervalMs = intervalMinutes * 60 * 1000;
  console.log(`Scheduling automated Plex sync every ${intervalMinutes} minutes.`);

  currentTimer = setInterval(async () => {
    console.log('[Scheduler] Running periodic Plex playlist synchronization...');
    try {
      const result = await SyncService.syncAllPlaylists('cron');
      console.log(`[Scheduler] Sync completed: ${result.synced} succeeded, ${result.failed} failed.`);
    } catch (err) {
      console.error('[Scheduler] Periodic sync failed:', err);
    }
  }, intervalMs);

  // Prevent timer from keeping the Node.js process alive if it's the only thing running
  if (currentTimer.unref) {
    currentTimer.unref();
  }
}
