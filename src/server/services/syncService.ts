import { randomUUID } from 'crypto';
import db from '../db/index.js';
import { PlexService } from '../plex/plexService.js';
import {
  continueSchedule,
  ShowConfig,
  InterleaveMode,
  SchedulerState,
} from '../engine/interleaveEngine.js';

export interface PlaylistRecord {
  id: string;
  name: string;
  plex_playlist_id: string | null;
  plex_playlist_title: string;
  mode: InterleaveMode;
  buffer_size: number;
  unwatched_only: number;
  enabled: number;
  last_synced_at: string | null;
  last_sync_status: string | null;
  last_synced_queue?: string | null;
  schedule_state?: string | null;
  schedule_config?: string | null;
  include_specials?: number;
  consecutive_episodes?: number;
  min_consecutive_episodes?: number;
  max_consecutive_episodes?: number;
}

export interface PlaylistShowRecord {
  id: string;
  playlist_id: string;
  plex_show_rating_key: string;
  show_title: string;
  show_thumb: string | null;
  season_count?: number | null;
  total_episodes?: number | null;
  unwatched_episodes?: number | null;
  sort_order: number;
  manual_weight: number;
}

export type WebhookOutcome = 'synced' | 'syncing' | 'no_playlist' | 'ignored' | 'rejected' | 'invalid' | 'error';

export class SyncService {
  private static readonly WEBHOOK_EVENTS_MAX = 200;
  private static isSyncing = false;
  private static syncingPlaylists = new Set<string>();
  private static pendingResync = new Set<string>();

  // library.new debouncing: a library scan fires one event per added item, so wait for a quiet period and sync once.
  // (Env overrides exist so the timing can be tested without waiting minutes.)
  private static readonly LIBRARY_QUIET_MS = Number(process.env.LIBRARY_SYNC_DEBOUNCE_MS) || 30_000;
  private static readonly LIBRARY_MAX_WAIT_MS = Number(process.env.LIBRARY_SYNC_MAX_WAIT_MS) || 5 * 60_000;
  private static libraryPending = new Map<
    string,
    { timer: ReturnType<typeof setTimeout>; firstAt: number; count: number; showTitle: string | null; account: string | null; player: string | null }
  >();

  private static readonly LOG_RETENTION_DAYS = 30;
  private static readonly LOG_MAX_ENTRIES = 500;

  /** Keep sync_logs bounded: drop entries older than 30 days or beyond the newest 500 */
  public static pruneLogs(): void {
    try {
      db.prepare(`DELETE FROM sync_logs WHERE created_at < datetime('now', ?)`).run(`-${this.LOG_RETENTION_DAYS} days`);
      db.prepare(
        `DELETE FROM sync_logs WHERE id NOT IN (SELECT id FROM sync_logs ORDER BY created_at DESC, rowid DESC LIMIT ?)`
      ).run(this.LOG_MAX_ENTRIES);
    } catch (err) {
      console.error('Failed to prune sync logs:', err);
    }
  }

  /** Minimal episode shape stored as the "last synced" baseline for the preview diff view */
  private static toSnapshot(queue: { ratingKey: string; showRatingKey: string; showTitle: string; seasonNumber: number; episodeNumber: number; title: string }[]) {
    return queue.map((ep) => ({
      ratingKey: ep.ratingKey,
      showRatingKey: ep.showRatingKey,
      showTitle: ep.showTitle,
      seasonNumber: ep.seasonNumber,
      episodeNumber: ep.episodeNumber,
      title: ep.title,
    }));
  }

  /** Compare the freshly calculated queue against what was last pushed to Plex */
  private static buildQueueDiff(playlist: PlaylistRecord, queue: { ratingKey: string; showTitle: string }[]) {
    let baseline: { ratingKey: string; showRatingKey?: string; showTitle: string; seasonNumber: number; episodeNumber: number; title: string }[] | null = null;
    if (playlist.last_synced_queue) {
      try {
        baseline = JSON.parse(playlist.last_synced_queue);
      } catch {
        baseline = null;
      }
    }
    if (!baseline) {
      return { hasBaseline: false, lastSyncedAt: playlist.last_synced_at, removed: [], added: [], unchanged: 0 };
    }

    const newKeys = new Set(queue.map((ep) => ep.ratingKey));
    const oldKeys = new Set(baseline.map((ep) => ep.ratingKey));
    const removed = baseline.filter((ep) => !newKeys.has(ep.ratingKey));
    const added = queue.filter((ep) => !oldKeys.has(ep.ratingKey)).map((ep) => ep.ratingKey);
    return {
      hasBaseline: true,
      lastSyncedAt: playlist.last_synced_at,
      removed,
      added,
      unchanged: baseline.length - removed.length,
    };
  }

  /**
   * The settings that shape the rotation. When any of them change, the saved rotation no longer applies and the
   * next sync starts it over (the show order is part of it because round-robin follows it).
   */
  private static scheduleConfigKey(playlist: PlaylistRecord, shows: PlaylistShowRecord[]): string {
    return JSON.stringify({
      mode: playlist.mode,
      buffer: playlist.buffer_size,
      unwatchedOnly: playlist.unwatched_only,
      specials: playlist.include_specials,
      min: playlist.min_consecutive_episodes || playlist.consecutive_episodes || 1,
      max: playlist.max_consecutive_episodes || playlist.min_consecutive_episodes || playlist.consecutive_episodes || 1,
      shows: shows.map((s) => [s.plex_show_rating_key, s.manual_weight]),
    });
  }

  /** The last synced queue and rotation position, if they still apply to the playlist's current settings */
  private static previousSchedule(playlist: PlaylistRecord, configKey: string): { queue: string[]; state: SchedulerState } | null {
    if (playlist.schedule_config !== configKey || !playlist.last_synced_queue || !playlist.schedule_state) return null;
    try {
      const queue = (JSON.parse(playlist.last_synced_queue) as { ratingKey: string }[]).map((ep) => String(ep.ratingKey));
      return { queue, state: JSON.parse(playlist.schedule_state) };
    } catch {
      return null;
    }
  }

  /** Build the queue, continuing the previous rotation where possible (see continueSchedule) */
  private static buildQueue(playlist: PlaylistRecord, shows: PlaylistShowRecord[], showConfigs: ShowConfig[]) {
    const configKey = this.scheduleConfigKey(playlist, shows);
    const minConsecutive = playlist.min_consecutive_episodes || playlist.consecutive_episodes || 1;
    const maxConsecutive = playlist.max_consecutive_episodes || minConsecutive;
    const result = continueSchedule(
      showConfigs,
      { mode: playlist.mode, bufferSize: playlist.buffer_size, minConsecutive, maxConsecutive },
      this.previousSchedule(playlist, configKey)
    );
    return { ...result, configKey };
  }

  /**
   * True when Plex already holds exactly this queue, so the playlist doesn't need to be rebuilt.
   * Rebuilding gives the playlist a new ID (which breaks pins and favourites in Plex), so it's worth one request to check.
   */
  private static async isPlexPlaylistCurrent(plex: PlexService, playlist: PlaylistRecord, keys: string[]): Promise<boolean> {
    let lastPushed: string[] | null = null;
    try {
      lastPushed = (JSON.parse(playlist.last_synced_queue || 'null') as { ratingKey: string }[] | null)?.map((ep) => String(ep.ratingKey)) ?? null;
    } catch {
      lastPushed = null;
    }
    // Cheap check first: anything different from what we pushed last time needs a rebuild
    if (!lastPushed || lastPushed.length !== keys.length || lastPushed.some((k, i) => k !== keys[i])) return false;
    if (keys.length === 0) return !playlist.plex_playlist_id;
    if (!playlist.plex_playlist_id) return false;

    // Then confirm Plex still has exactly that, in case the playlist was deleted or edited by hand
    const actual = await plex.getPlaylistItemKeys(playlist.plex_playlist_id);
    return !!actual && actual.length === keys.length && actual.every((k, i) => k === keys[i]);
  }

  /** Season 0 is Plex's "Specials"; playlists can opt out of them */
  private static applySpecialsFilter<T extends { seasonNumber: number }>(episodes: T[], playlist: PlaylistRecord): T[] {
    return playlist.include_specials === 0 ? episodes.filter((ep) => ep.seasonNumber !== 0) : episodes;
  }

  public static getPlexService(): PlexService {
    const settings = db.prepare('SELECT * FROM settings WHERE id = 1').get() as any;
    if (!settings || !settings.plex_url || !settings.plex_token) {
      throw new Error('Plex server settings are not configured yet.');
    }
    // Each install gets its own stable client identifier so multiple instances don't collide in Plex's device registry
    let clientId: string = settings.plex_client_id;
    if (!clientId) {
      clientId = `plex-playlist-creator-${randomUUID()}`;
      db.prepare('UPDATE settings SET plex_client_id = ? WHERE id = 1').run(clientId);
    }
    return new PlexService(settings.plex_url, settings.plex_token, clientId);
  }

  /**
   * Refresh metadata (unwatched count, episodes, seasons, thumb) for all shows in a playlist
   */
  public static async refreshPlaylistShowStats(playlistId: string): Promise<any[]> {
    const playlist = db.prepare('SELECT * FROM playlists WHERE id = ?').get(playlistId) as PlaylistRecord | undefined;
    if (!playlist) {
      throw new Error(`Playlist with ID ${playlistId} not found`);
    }

    const shows = db
      .prepare('SELECT * FROM playlist_shows WHERE playlist_id = ? ORDER BY sort_order ASC')
      .all(playlistId) as PlaylistShowRecord[];

    if (shows.length === 0) return [];

    const plex = this.getPlexService();
    const updateStmt = db.prepare(
      `UPDATE playlist_shows SET
        season_count = COALESCE(?, season_count),
        total_episodes = COALESCE(?, total_episodes),
        unwatched_episodes = COALESCE(?, unwatched_episodes),
        show_thumb = COALESCE(?, show_thumb)
       WHERE id = ?`
    );

    // Parallelize metadata fetches across all shows
    const results = await Promise.allSettled(
      shows.map((show) => plex.getShowMetadata(show.plex_show_rating_key))
    );

    const refreshedShows = [];

    for (let i = 0; i < shows.length; i++) {
      const show = shows[i];
      const result = results[i];
      if (result.status === 'fulfilled' && result.value) {
        const metadata = result.value;
        updateStmt.run(
          metadata.seasonCount,
          metadata.totalEpisodes,
          metadata.unwatchedEpisodes,
          metadata.thumb || show.show_thumb,
          show.id
        );
        refreshedShows.push({
          id: show.id,
          ratingKey: show.plex_show_rating_key,
          title: show.show_title,
          thumb: metadata.thumb || show.show_thumb,
          seasonCount: metadata.seasonCount,
          totalEpisodes: metadata.totalEpisodes,
          unwatchedEpisodes: metadata.unwatchedEpisodes,
          sortOrder: show.sort_order,
          manualWeight: show.manual_weight,
        });
      } else {
        // Plex couldn't be reached for this show: keep the stored values, in the same shape the client expects
        refreshedShows.push({
          id: show.id,
          ratingKey: show.plex_show_rating_key,
          title: show.show_title,
          thumb: show.show_thumb,
          seasonCount: show.season_count,
          totalEpisodes: show.total_episodes,
          unwatchedEpisodes: show.unwatched_episodes,
          sortOrder: show.sort_order,
          manualWeight: show.manual_weight,
        });
      }
    }

    return refreshedShows;
  }

  /**
   * Preview the interleaved queue without updating Plex
   */
  public static async previewQueue(playlistId: string): Promise<any> {
    const playlist = db.prepare('SELECT * FROM playlists WHERE id = ?').get(playlistId) as PlaylistRecord | undefined;
    if (!playlist) {
      throw new Error(`Playlist with ID ${playlistId} not found`);
    }

    const shows = db
      .prepare('SELECT * FROM playlist_shows WHERE playlist_id = ? ORDER BY sort_order ASC')
      .all(playlistId) as PlaylistShowRecord[];

    if (shows.length === 0) {
      return { episodes: [], showStats: [] };
    }

    const plex = this.getPlexService();
    const showConfigs: ShowConfig[] = [];
    const showStats: any[] = [];

    const updateUnwatchedStmt = db.prepare(
      'UPDATE playlist_shows SET unwatched_episodes = ? WHERE playlist_id = ? AND plex_show_rating_key = ?'
    );

    const unwatchedOnly = playlist.unwatched_only === 1;
    const episodeResults = await Promise.allSettled(
      shows.map((show) => plex.getShowEpisodes(show.plex_show_rating_key, unwatchedOnly))
    );

    for (let i = 0; i < shows.length; i++) {
      const show = shows[i];
      const result = episodeResults[i];
      if (result.status === 'rejected') {
        throw new Error(`Failed to fetch episodes for "${show.show_title}": ${result.reason?.message || result.reason}`);
      }
      const episodes = this.applySpecialsFilter(result.value, playlist);

      if (unwatchedOnly) {
        try {
          updateUnwatchedStmt.run(episodes.length, playlistId, show.plex_show_rating_key);
        } catch {}
      }

      showConfigs.push({
        ratingKey: show.plex_show_rating_key,
        title: show.show_title,
        manualWeight: show.manual_weight,
        episodes,
      });

      showStats.push({
        ratingKey: show.plex_show_rating_key,
        title: show.show_title,
        thumb: show.show_thumb,
        manualWeight: show.manual_weight,
        episodeCount: episodes.length,
      });
    }

    // Same continuation logic as the next sync, so the preview shows exactly what would be pushed
    const queue = this.buildQueue(playlist, shows, showConfigs).episodes;

    return {
      episodes: queue,
      showStats,
      totalEpisodesInQueue: queue.length,
      diff: this.buildQueueDiff(playlist, queue),
    };
  }

  /**
   * Synchronize a specific playlist with Plex Media Server
   */
  public static async syncPlaylistById(
    playlistId: string,
    triggerType: 'manual' | 'cron' | 'webhook' = 'manual'
  ): Promise<any> {
    if (this.syncingPlaylists.has(playlistId)) {
      // A watch event mid-sync means the queue is already stale; remember to run once more afterwards
      if (triggerType === 'webhook') this.pendingResync.add(playlistId);
      throw new Error('A sync is already in progress for this playlist.');
    }

    this.syncingPlaylists.add(playlistId);
    try {
      return await this.runPlaylistSync(playlistId, triggerType);
    } finally {
      this.syncingPlaylists.delete(playlistId);
      this.pruneLogs();
      if (this.pendingResync.delete(playlistId)) {
        this.syncPlaylistById(playlistId, 'webhook').catch((err) =>
          console.error(`Follow-up sync for playlist ${playlistId} failed:`, err)
        );
      }
    }
  }

  private static async runPlaylistSync(
    playlistId: string,
    triggerType: 'manual' | 'cron' | 'webhook'
  ): Promise<any> {
    const logId = randomUUID();
    const playlist = db.prepare('SELECT * FROM playlists WHERE id = ?').get(playlistId) as PlaylistRecord | undefined;
    if (!playlist) {
      throw new Error(`Playlist ${playlistId} not found`);
    }

    try {
      const shows = db
        .prepare('SELECT * FROM playlist_shows WHERE playlist_id = ? ORDER BY sort_order ASC')
        .all(playlistId) as PlaylistShowRecord[];

      if (shows.length === 0) {
        db.prepare(
          'INSERT INTO sync_logs (id, playlist_id, playlist_name, status, episodes_synced, message, trigger_type) VALUES (?, ?, ?, ?, ?, ?, ?)'
        ).run(
          logId,
          playlist.id,
          playlist.name,
          'success',
          0,
          'Playlist has no shows configured. Skipped.',
          triggerType
        );
        return { count: 0, message: 'No shows selected.' };
      }

      const plex = this.getPlexService();
      const showConfigs: ShowConfig[] = [];
      const updateUnwatchedStmt = db.prepare(
        'UPDATE playlist_shows SET unwatched_episodes = ? WHERE playlist_id = ? AND plex_show_rating_key = ?'
      );

      const syncUnwatchedOnly = playlist.unwatched_only === 1;
      const syncEpisodeResults = await Promise.allSettled(
        shows.map((show) => plex.getShowEpisodes(show.plex_show_rating_key, syncUnwatchedOnly))
      );

      for (let i = 0; i < shows.length; i++) {
        const show = shows[i];
        const result = syncEpisodeResults[i];
        if (result.status === 'rejected') {
          throw new Error(`Failed to fetch episodes for "${show.show_title}": ${result.reason?.message || result.reason}`);
        }
        const episodes = this.applySpecialsFilter(result.value, playlist);

        if (syncUnwatchedOnly) {
          try {
            updateUnwatchedStmt.run(episodes.length, playlistId, show.plex_show_rating_key);
          } catch {}
        }

        showConfigs.push({
          ratingKey: show.plex_show_rating_key,
          title: show.show_title,
          manualWeight: show.manual_weight,
          episodes,
        });
      }

      const scheduled = this.buildQueue(playlist, shows, showConfigs);
      const queue = scheduled.episodes;
      const episodeRatingKeys = queue.map((ep) => ep.ratingKey);
      const scheduleState = JSON.stringify(scheduled.state);

      if (await this.isPlexPlaylistCurrent(plex, playlist, episodeRatingKeys)) {
        db.prepare(
          `UPDATE playlists SET
            last_synced_at = CURRENT_TIMESTAMP,
            last_sync_status = 'success',
            schedule_state = ?,
            schedule_config = ?,
            updated_at = CURRENT_TIMESTAMP
          WHERE id = ?`
        ).run(scheduleState, scheduled.configKey, playlist.id);

        // Scheduled and webhook checks that find nothing to do would otherwise fill the history; only log manual ones
        if (triggerType === 'manual') {
          db.prepare(
            'INSERT INTO sync_logs (id, playlist_id, playlist_name, status, episodes_synced, message, trigger_type) VALUES (?, ?, ?, ?, ?, ?, ?)'
          ).run(logId, playlist.id, playlist.name, 'success', queue.length, `No changes: Plex playlist already up to date (${queue.length} episodes)`, triggerType);
        }
        return {
          success: true,
          unchanged: true,
          episodesSynced: queue.length,
          plexPlaylistId: playlist.plex_playlist_id,
        };
      }

      // Perform Plex sync
      const result = await plex.syncPlaylist(
        playlist.plex_playlist_title,
        playlist.plex_playlist_id,
        episodeRatingKeys
      );

      // Update playlist record in SQLite
      db.prepare(
        `UPDATE playlists SET 
          plex_playlist_id = ?, 
          last_synced_at = CURRENT_TIMESTAMP, 
          last_sync_status = 'success',
          last_synced_queue = ?,
          schedule_state = ?,
          schedule_config = ?,
          updated_at = CURRENT_TIMESTAMP 
        WHERE id = ?`
      ).run(result.plexPlaylistId, JSON.stringify(this.toSnapshot(queue)), scheduleState, scheduled.configKey, playlist.id);

      // Log success
      db.prepare(
        'INSERT INTO sync_logs (id, playlist_id, playlist_name, status, episodes_synced, message, trigger_type) VALUES (?, ?, ?, ?, ?, ?, ?)'
      ).run(
        logId,
        playlist.id,
        playlist.name,
        'success',
        result.count,
        `Successfully synced ${result.count} episodes to Plex`,
        triggerType
      );

      return {
        success: true,
        episodesSynced: result.count,
        plexPlaylistId: result.plexPlaylistId,
      };
    } catch (err: any) {
      console.error(`Sync error on playlist ${playlist.name}:`, err);

      db.prepare(
        `UPDATE playlists SET 
          last_synced_at = CURRENT_TIMESTAMP, 
          last_sync_status = 'error',
          updated_at = CURRENT_TIMESTAMP 
        WHERE id = ?`
      ).run(playlist.id);

      db.prepare(
        'INSERT INTO sync_logs (id, playlist_id, playlist_name, status, episodes_synced, message, trigger_type) VALUES (?, ?, ?, ?, ?, ?, ?)'
      ).run(
        logId,
        playlist.id,
        playlist.name,
        'error',
        0,
        err.message || 'Unknown sync error',
        triggerType
      );

      throw err;
    }
  }

  /**
   * Synchronize all enabled playlists
   */
  public static async syncAllPlaylists(
    triggerType: 'manual' | 'cron' | 'webhook' = 'cron'
  ): Promise<{ synced: number; failed: number }> {
    if (this.isSyncing) {
      console.log('Sync-all already in progress, skipping concurrent run.');
      return { synced: 0, failed: 0 };
    }

    this.isSyncing = true;
    let synced = 0;
    let failed = 0;

    try {
      const enabledPlaylists = db
        .prepare('SELECT id FROM playlists WHERE enabled = 1')
        .all() as { id: string }[];

      const results = await Promise.allSettled(
        enabledPlaylists.map((p) => this.syncPlaylistById(p.id, triggerType))
      );
      for (const r of results) {
        if (r.status === 'fulfilled') synced++;
        else failed++;
      }
    } finally {
      this.isSyncing = false;
    }

    return { synced, failed };
  }

  /**
   * Record one incoming webhook for the "Webhook activity" view. Plex sends several events per episode
   * (play, pause, resume, stop...), most of which are ignored, so this is the only way to see whether
   * Plex is reaching the app at all. Returns the row id so the outcome can be updated after a sync.
   */
  public static recordWebhookEvent(e: {
    event?: string | null;
    showTitle?: string | null;
    account?: string | null;
    player?: string | null;
    outcome: WebhookOutcome;
    detail?: string | null;
  }): number | null {
    const clip = (v?: string | null) => (v == null ? null : String(v).slice(0, 200));
    try {
      const result = db
        .prepare('INSERT INTO webhook_events (event, show_title, account, player, outcome, detail) VALUES (?, ?, ?, ?, ?, ?)')
        .run(clip(e.event), clip(e.showTitle), clip(e.account), clip(e.player), e.outcome, clip(e.detail));
      db.prepare(
        'DELETE FROM webhook_events WHERE id NOT IN (SELECT id FROM webhook_events ORDER BY id DESC LIMIT ?)'
      ).run(this.WEBHOOK_EVENTS_MAX);
      return Number(result.lastInsertRowid);
    } catch (err) {
      console.error('Failed to record webhook event:', err);
      return null;
    }
  }

  private static updateWebhookEvent(id: number | null, outcome: WebhookOutcome, detail: string | null) {
    if (id === null) return;
    try {
      db.prepare('UPDATE webhook_events SET outcome = ?, detail = ? WHERE id = ?').run(outcome, detail?.slice(0, 200) ?? null, id);
    } catch (err) {
      console.error('Failed to update webhook event:', err);
    }
  }

  /**
   * Playlists (enabled) that contain the given show
   */
  private static findPlaylistsForShow(showRatingKey: string): { id: string; name: string }[] {
    return db
      .prepare(
        `SELECT DISTINCT p.id, p.name
         FROM playlists p
         JOIN playlist_shows ps ON p.id = ps.playlist_id
         WHERE ps.plex_show_rating_key = ? AND p.enabled = 1`
      )
      .all(showRatingKey) as { id: string; name: string }[];
  }

  /**
   * library.* events. Plex sends one per added item during a library scan, so they are NOT recorded or logged
   * (they would drown out everything else), except when new content lands in a show that is in an enabled
   * playlist: that schedules one debounced sync of the playlist so the queue picks up the new episodes.
   */
  private static handleLibraryEvent(event: string, payload: any): void {
    if (event !== 'library.new') return;

    const md = payload?.Metadata;
    // Map whatever was added (episode, season or show) to its show
    let showKey: unknown;
    let showTitle: string | null = null;
    if (md?.type === 'episode') {
      showKey = md.grandparentRatingKey;
      showTitle = md.grandparentTitle ?? null;
    } else if (md?.type === 'season') {
      showKey = md.parentRatingKey;
      showTitle = md.parentTitle ?? null;
    } else if (md?.type === 'show') {
      showKey = md.ratingKey;
      showTitle = md.title ?? null;
    }
    if (!showKey) return;

    const playlists = this.findPlaylistsForShow(String(showKey));
    if (playlists.length === 0) return;

    const account: string | null = payload?.Account?.title ?? null;
    const player: string | null = payload?.Player?.title ?? null;
    const now = Date.now();

    for (const p of playlists) {
      const existing = this.libraryPending.get(p.id);
      const firstAt = existing?.firstAt ?? now;
      if (existing) clearTimeout(existing.timer);

      // Quiet period after the latest event, but never later than MAX_WAIT after the first one
      const delay = Math.max(0, Math.min(this.LIBRARY_QUIET_MS, firstAt + this.LIBRARY_MAX_WAIT_MS - now));
      const timer = setTimeout(() => {
        const entry = this.libraryPending.get(p.id);
        this.libraryPending.delete(p.id);
        if (entry) {
          this.runLibrarySync(p.id, entry).catch((err) => console.error(`Library-triggered sync of ${p.id} failed:`, err));
        }
      }, delay);
      timer.unref();

      this.libraryPending.set(p.id, {
        timer,
        firstAt,
        count: (existing?.count ?? 0) + 1,
        showTitle: showTitle ?? existing?.showTitle ?? null,
        account,
        player,
      });
    }
  }

  private static async runLibrarySync(
    playlistId: string,
    entry: { count: number; showTitle: string | null; account: string | null; player: string | null }
  ): Promise<void> {
    const playlist = db.prepare('SELECT name FROM playlists WHERE id = ? AND enabled = 1').get(playlistId) as { name: string } | undefined;
    if (!playlist) return; // deleted or disabled while waiting

    const added = `${entry.count} new item${entry.count === 1 ? '' : 's'} added${entry.showTitle ? ` to "${entry.showTitle}"` : ''}`;
    console.log(`[Webhook] library.new | ${entry.showTitle ?? '-'} -> syncing: ${added}; syncing ${playlist.name}`);
    const eventId = this.recordWebhookEvent({
      event: 'library.new',
      showTitle: entry.showTitle,
      account: entry.account,
      player: entry.player,
      outcome: 'syncing',
      detail: `${added}; syncing ${playlist.name}`,
    });

    try {
      const result = await this.syncPlaylistById(playlistId, 'webhook');
      this.updateWebhookEvent(
        eventId,
        'synced',
        result?.unchanged ? `${added}; ${playlist.name} already up to date` : `${added}; synced ${playlist.name}`
      );
    } catch (err: any) {
      if (/already in progress/i.test(err?.message || '')) {
        this.updateWebhookEvent(eventId, 'synced', `${added}; ${playlist.name} was already syncing (follow-up queued)`);
      } else {
        this.updateWebhookEvent(eventId, 'error', `${added}; ${playlist.name}: ${err?.message || 'sync failed'}`);
      }
    }
  }

  /**
   * Handle Plex Webhook event (instant scrobble sync)
   */
  public static async handleWebhook(payload: any): Promise<void> {
    const event: string | null = typeof payload?.event === 'string' ? payload.event : null;

    if (event?.startsWith('library.')) {
      this.handleLibraryEvent(event, payload);
      return;
    }

    const metadata = payload?.Metadata;
    const account: string | null = payload?.Account?.title ?? null;
    const player: string | null = payload?.Player?.title ?? null;
    const showTitle: string | null = metadata?.grandparentTitle || metadata?.title || null;

    const note = (outcome: WebhookOutcome, detail?: string): number | null => {
      console.log(
        `[Webhook] ${event ?? 'no event'} | ${showTitle ?? '-'} | account=${account ?? '-'} player=${player ?? '-'} -> ${outcome}${detail ? `: ${detail}` : ''}`
      );
      return this.recordWebhookEvent({ event, showTitle, account, player, outcome, detail });
    };

    if (!event) {
      note('invalid', 'Payload had no "event" field (unreadable body, or not sent by Plex)');
      return;
    }
    // We only act on media.scrobble (episode marked watched); everything else is just recorded
    if (event !== 'media.scrobble') {
      note('ignored', 'Only media.scrobble triggers a sync');
      return;
    }
    if (metadata?.type !== 'episode') {
      note('ignored', `Not an episode (type: ${metadata?.type ?? 'unknown'})`);
      return;
    }

    const rawRatingKey = metadata?.grandparentRatingKey;
    if (!rawRatingKey) {
      note('invalid', 'Episode event had no grandparentRatingKey');
      return;
    }
    const showRatingKey = String(rawRatingKey);

    // Find playlists containing this show
    const matchingPlaylists = this.findPlaylistsForShow(showRatingKey);

    if (matchingPlaylists.length === 0) {
      note('no_playlist', `"${showTitle ?? showRatingKey}" is not in any enabled playlist`);
      return;
    }

    const eventId = note('syncing', matchingPlaylists.map((p) => p.name).join(', '));

    let ok = 0;
    let upToDate = 0;
    let busy = 0;
    const failures: string[] = [];
    for (const p of matchingPlaylists) {
      console.log(`Advancing playlist ${p.id} via webhook trigger...`);
      try {
        const result = await this.syncPlaylistById(p.id, 'webhook');
        if (result?.unchanged) upToDate++;
        else ok++;
      } catch (err: any) {
        if (/already in progress/i.test(err?.message || '')) {
          busy++; // a follow-up sync was queued by the lock
        } else {
          failures.push(`${p.name}: ${err?.message || 'sync failed'}`);
          console.error(`Error syncing playlist ${p.id} on webhook:`, err);
        }
      }
    }

    if (failures.length > 0) {
      this.updateWebhookEvent(eventId, 'error', failures.join('; '));
    } else {
      const parts: string[] = [];
      if (ok > 0 || (upToDate === 0 && busy === 0)) parts.push(`Synced ${ok} playlist${ok === 1 ? '' : 's'}`);
      if (upToDate > 0) parts.push(`${upToDate} already up to date`);
      if (busy > 0) parts.push(`${busy} already syncing (follow-up queued)`);
      this.updateWebhookEvent(eventId, 'synced', parts.join(', '));
    }
  }
}
