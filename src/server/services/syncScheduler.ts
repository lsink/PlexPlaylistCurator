import cron from 'node-cron';
import db from '../db/index.js';
import { SyncService } from './syncService.js';

let currentTask: cron.ScheduledTask | null = null;

export function initSyncScheduler() {
  const settings = db.prepare('SELECT auto_sync_interval_minutes FROM settings WHERE id = 1').get() as any;
  const interval = settings?.auto_sync_interval_minutes || 30;
  scheduleSync(interval);
}

export function updateSyncSchedule(intervalMinutes: number) {
  if (currentTask) {
    currentTask.stop();
    currentTask = null;
  }
  scheduleSync(intervalMinutes);
}

function scheduleSync(intervalMinutes: number) {
  // If interval is 0 or negative, disable cron
  if (intervalMinutes <= 0) {
    console.log('Automated periodic sync is disabled.');
    return;
  }

  // Create cron pattern: every X minutes (if interval < 60) or hourly
  let cronPattern = `*/${Math.min(intervalMinutes, 59)} * * * *`;
  if (intervalMinutes >= 60) {
    const hours = Math.floor(intervalMinutes / 60);
    cronPattern = `0 */${Math.min(hours, 24)} * * *`;
  }

  console.log(`Scheduling automated Plex sync every ${intervalMinutes} minutes (cron: "${cronPattern}")`);

  currentTask = cron.schedule(cronPattern, async () => {
    console.log('[Scheduler] Running periodic Plex playlist synchronization...');
    try {
      const result = await SyncService.syncAllPlaylists('cron');
      console.log(`[Scheduler] Sync completed: ${result.synced} succeeded, ${result.failed} failed.`);
    } catch (err) {
      console.error('[Scheduler] Periodic sync failed:', err);
    }
  });
}
