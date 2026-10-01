export type InterleaveMode = 'round_robin' | 'auto_proportional' | 'manual_weighted' | 'chronological' | 'runtime_balanced';

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
  includeSpecials?: boolean;
  consecutiveEpisodes?: number;
  minConsecutiveEpisodes?: number;
  maxConsecutiveEpisodes?: number;
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

export interface SyncDiff {
  hasBaseline: boolean;
  lastSyncedAt: string | null;
  /** Episodes in the last synced queue that are no longer in the calculated queue */
  removed: Array<{
    ratingKey: string;
    showTitle: string;
    seasonNumber: number;
    episodeNumber: number;
    title: string;
  }>;
  /** ratingKeys of episodes that are new compared to the last synced queue */
  added: string[];
  unchanged: number;
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
  diff?: SyncDiff;
}

export interface SettingsData {
  appVersion?: string;
  plexUrl: string;
  plexTokenMasked: string;
  hasToken: boolean;
  plexServerName: string;
  isConfigured: boolean;
  autoSyncIntervalMinutes: number;
  hasWebhookSecret: boolean;
}

export type WebhookOutcome = 'synced' | 'syncing' | 'no_playlist' | 'ignored' | 'rejected' | 'invalid' | 'error';

export interface WebhookEvent {
  id: number;
  received_at: string;
  event: string | null;
  show_title: string | null;
  account: string | null;
  player: string | null;
  outcome: WebhookOutcome;
  detail: string | null;
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
