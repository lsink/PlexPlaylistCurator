import { randomUUID } from 'crypto';
import db from '../db/index.js';
import { PlexService } from '../plex/plexService.js';
import {
  interleaveEpisodes,
  ShowConfig,
  InterleaveMode,
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
  consecutive_episodes?: number;
}

export interface PlaylistShowRecord {
  id: string;
  playlist_id: string;
  plex_show_rating_key: string;
  show_title: string;
  show_thumb: string | null;
  sort_order: number;
  manual_weight: number;
}

export class SyncService {
  private static isSyncing = false;

  public static getPlexService(): PlexService {
    const settings = db.prepare('SELECT * FROM settings WHERE id = 1').get() as any;
    if (!settings || !settings.plex_url || !settings.plex_token) {
      throw new Error('Plex server settings are not configured yet.');
    }
    return new PlexService(settings.plex_url, settings.plex_token);
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

    for (const show of shows) {
      const episodes = await plex.getShowEpisodes(
        show.plex_show_rating_key,
        playlist.unwatched_only === 1
      );

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

    const queue = interleaveEpisodes(showConfigs, {
      mode: playlist.mode,
      bufferSize: playlist.buffer_size,
      consecutiveEpisodes: playlist.consecutive_episodes || 1,
    });

    return {
      episodes: queue,
      showStats,
      totalEpisodesInQueue: queue.length,
    };
  }

  /**
   * Synchronize a specific playlist with Plex Media Server
   */
  public static async syncPlaylistById(
    playlistId: string,
    triggerType: 'manual' | 'cron' | 'webhook' = 'manual'
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

      for (const show of shows) {
        const episodes = await plex.getShowEpisodes(
          show.plex_show_rating_key,
          playlist.unwatched_only === 1
        );

        showConfigs.push({
          ratingKey: show.plex_show_rating_key,
          title: show.show_title,
          manualWeight: show.manual_weight,
          episodes,
        });
      }

      const queue = interleaveEpisodes(showConfigs, {
        mode: playlist.mode,
        bufferSize: playlist.buffer_size,
        consecutiveEpisodes: playlist.consecutive_episodes || 1,
      });

      const episodeRatingKeys = queue.map((ep) => ep.ratingKey);

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
          updated_at = CURRENT_TIMESTAMP 
        WHERE id = ?`
      ).run(result.plexPlaylistId, playlist.id);

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
      console.log('Sync already in progress, skipping concurrent run.');
      return { synced: 0, failed: 0 };
    }

    this.isSyncing = true;
    let synced = 0;
    let failed = 0;

    try {
      const enabledPlaylists = db
        .prepare('SELECT id FROM playlists WHERE enabled = 1')
        .all() as { id: string }[];

      for (const p of enabledPlaylists) {
        try {
          await this.syncPlaylistById(p.id, triggerType);
          synced++;
        } catch (err) {
          failed++;
        }
      }
    } finally {
      this.isSyncing = false;
    }

    return { synced, failed };
  }

  /**
   * Handle Plex Webhook event (instant scrobble sync)
   */
  public static async handleWebhook(payload: any): Promise<void> {
    const event = payload?.event;
    // We care about media.scrobble (episode marked watched)
    if (event !== 'media.scrobble') {
      return;
    }

    const metadata = payload?.Metadata;
    if (metadata?.type !== 'episode') {
      return;
    }

    const showRatingKey = String(metadata?.grandparentRatingKey);
    if (!showRatingKey) {
      return;
    }

    console.log(`Webhook received: Show "${metadata.grandparentTitle}" episode watched.`);

    // Find playlists containing this show
    const matchingPlaylists = db
      .prepare(
        `SELECT DISTINCT p.id 
         FROM playlists p 
         JOIN playlist_shows ps ON p.id = ps.playlist_id 
         WHERE ps.plex_show_rating_key = ? AND p.enabled = 1`
      )
      .all(showRatingKey) as { id: string }[];

    for (const p of matchingPlaylists) {
      console.log(`Advancing playlist ${p.id} via webhook trigger...`);
      try {
        await this.syncPlaylistById(p.id, 'webhook');
      } catch (err) {
        console.error(`Error syncing playlist ${p.id} on webhook:`, err);
      }
    }
  }
}
