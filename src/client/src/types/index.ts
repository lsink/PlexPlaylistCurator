export type InterleaveMode = 'round_robin' | 'auto_proportional' | 'manual_weighted' | 'chronological';

export interface ShowItem {
  id?: string;
  ratingKey: string;
  title: string;
  thumb?: string | null;
  art?: string | null;
  year?: number;
  seasonCount?: number;
  totalEpisodes?: number;
  unwatchedEpisodes?: number;
  sortOrder?: number;
  manualWeight?: number;
}

export interface Playlist {
  id: string;
  name: string;
  plex_playlist_id: string | null;
  plex_playlist_title: string;
  mode: InterleaveMode;
  buffer_size: number;
  unwatchedOnly: boolean;
  enabled: boolean;
  last_synced_at: string | null;
  last_sync_status: string | null;
  shows: ShowItem[];
}

export interface EpisodeQueueItem {
  ratingKey: string;
  showRatingKey: string;
  showTitle: string;
  seasonNumber: number;
  episodeNumber: number;
  title: string;
  airDate?: string;
  thumb?: string;
  duration?: number;
}

export interface PreviewData {
  episodes: EpisodeQueueItem[];
  showStats: Array<{
    ratingKey: string;
    title: string;
    thumb?: string;
    manualWeight?: number;
    episodeCount: number;
  }>;
  totalEpisodesInQueue: number;
}

export interface SettingsData {
  plexUrl: string;
  plexTokenMasked: string;
  hasToken: boolean;
  plexServerName: string;
  isConfigured: boolean;
  autoSyncIntervalMinutes: number;
  webhookSecret: string;
}

export interface SyncLog {
  id: string;
  playlist_id: string | null;
  playlist_name: string | null;
  status: 'success' | 'error' | 'running';
  episodes_synced: number;
  message: string;
  trigger_type: 'manual' | 'cron' | 'webhook';
  created_at: string;
}
