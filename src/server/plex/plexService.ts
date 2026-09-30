import axios, { AxiosInstance } from 'axios';
import { EpisodeItem } from '../engine/interleaveEngine.js';

export interface PlexServerInfo {
  friendlyName: string;
  machineIdentifier: string;
  version: string;
  platform: string;
}

export interface PlexLibrarySection {
  key: string;
  title: string;
  type: string;
  uuid: string;
}

export interface PlexShowSummary {
  ratingKey: string;
  title: string;
  thumb?: string;
  art?: string;
  year?: number;
  seasonCount: number;
  totalEpisodes: number;
  unwatchedEpisodes: number;
}

export class PlexService {
  private client: AxiosInstance;
  private baseUrl: string;
  private token: string;
  private machineIdentifier: string = '';

  constructor(url: string, token: string) {
    let cleanUrl = url.trim();
    if (!cleanUrl.startsWith('http://') && !cleanUrl.startsWith('https://')) {
      cleanUrl = `http://${cleanUrl}`;
    }
    // Remove trailing slash
    cleanUrl = cleanUrl.replace(/\/+$/, '');

    this.baseUrl = cleanUrl;
    this.token = token.trim();

    this.client = axios.create({
      baseURL: this.baseUrl,
      timeout: 15000,
      headers: {
        'X-Plex-Token': this.token,
        'Accept': 'application/json',
        'X-Plex-Client-Identifier': 'plex-playlist-creator-proxmox',
        'X-Plex-Product': 'Plex Interleaved Playlist Creator',
        'X-Plex-Version': '1.0.0',
        'X-Plex-Device': 'Proxmox LXC',
        'X-Plex-Device-Name': 'Playlist Creator Service',
      },
    });
  }

  public getBaseUrl(): string {
    return this.baseUrl;
  }

  public getToken(): string {
    return this.token;
  }

  /**
   * Test connection and retrieve server identity
   */
  async testConnection(): Promise<PlexServerInfo> {
    const response = await this.client.get('/identity');
    const container = response.data?.MediaContainer;
    if (!container) {
      throw new Error('Invalid response received from Plex Media Server');
    }

    this.machineIdentifier = container.machineIdentifier || '';

    // Fetch friendly name and version from root
    let friendlyName = 'Plex Server';
    let version = '';
    let platform = '';

    try {
      const rootRes = await this.client.get('/');
      const rootContainer = rootRes.data?.MediaContainer;
      if (rootContainer) {
        friendlyName = rootContainer.friendlyName || friendlyName;
        version = rootContainer.version || '';
        platform = rootContainer.platform || '';
      }
    } catch {
      // Fallback if root access differs
    }

    return {
      friendlyName,
      machineIdentifier: this.machineIdentifier,
      version,
      platform,
    };
  }

  /**
   * Get machine identifier (cached or fetched)
   */
  async getMachineIdentifier(): Promise<string> {
    if (this.machineIdentifier) {
      return this.machineIdentifier;
    }
    const info = await this.testConnection();
    return info.machineIdentifier;
  }

  /**
   * Get TV Show libraries
   */
  async getShowLibraries(): Promise<PlexLibrarySection[]> {
    const response = await this.client.get('/library/sections');
    const directories = response.data?.MediaContainer?.Directory || [];
    return directories
      .filter((dir: any) => dir.type === 'show')
      .map((dir: any) => ({
        key: String(dir.key),
        title: dir.title,
        type: dir.type,
        uuid: dir.uuid || '',
      }));
  }

  /**
   * Get all TV shows in a library section with episode counts
   */
  async getShows(sectionKey: string): Promise<PlexShowSummary[]> {
    const response = await this.client.get(`/library/sections/${sectionKey}/all?type=2`);
    const metadataList = response.data?.MediaContainer?.Metadata || [];

    return metadataList.map((item: any) => {
      const totalLeaves = item.leafCount || 0;
      const viewedLeaves = item.viewedLeafCount || 0;
      const unwatchedLeaves = Math.max(0, totalLeaves - viewedLeaves);

      return {
        ratingKey: String(item.ratingKey),
        title: item.title,
        thumb: item.thumb,
        art: item.art,
        year: item.year,
        seasonCount: item.childCount || 1,
        totalEpisodes: totalLeaves,
        unwatchedEpisodes: unwatchedLeaves,
      };
    });
  }

  /**
   * Search shows across all TV libraries
   */
  async searchShows(query: string): Promise<PlexShowSummary[]> {
    const libraries = await this.getShowLibraries();
    const results: PlexShowSummary[] = [];

    for (const lib of libraries) {
      try {
        const response = await this.client.get(
          `/library/sections/${lib.key}/all?type=2&title=${encodeURIComponent(query)}`
        );
        const metadataList = response.data?.MediaContainer?.Metadata || [];
        for (const item of metadataList) {
          const totalLeaves = item.leafCount || 0;
          const viewedLeaves = item.viewedLeafCount || 0;
          results.push({
            ratingKey: String(item.ratingKey),
            title: item.title,
            thumb: item.thumb,
            art: item.art,
            year: item.year,
            seasonCount: item.childCount || 1,
            totalEpisodes: totalLeaves,
            unwatchedEpisodes: Math.max(0, totalLeaves - viewedLeaves),
          });
        }
      } catch (err) {
        console.error(`Error searching library ${lib.key}:`, err);
      }
    }

    return results;
  }

  /**
   * Fetch all episodes for a given show, optionally filtering for unwatched only.
   * Episodes are strictly sorted by Season ascending, then Episode ascending.
   */
  async getShowEpisodes(showRatingKey: string, unwatchedOnly = true): Promise<EpisodeItem[]> {
    const response = await this.client.get(`/library/metadata/${showRatingKey}/allLeaves`);
    const metadata = response.data?.MediaContainer?.Metadata || [];

    const episodes: EpisodeItem[] = [];

    for (const item of metadata) {
      const viewCount = item.viewCount || 0;
      if (unwatchedOnly && viewCount > 0) {
        continue;
      }

      episodes.push({
        ratingKey: String(item.ratingKey),
        showRatingKey: String(item.grandparentRatingKey || showRatingKey),
        showTitle: item.grandparentTitle || item.title,
        seasonNumber: item.parentIndex ?? 1,
        episodeNumber: item.index ?? 1,
        title: item.title || `Episode ${item.index ?? 1}`,
        airDate: item.originallyAvailableAt,
        thumb: item.thumb,
        duration: item.duration,
      });
    }

    // Sort strictly by season, then episode
    episodes.sort((a, b) => {
      if (a.seasonNumber !== b.seasonNumber) {
        return a.seasonNumber - b.seasonNumber;
      }
      return a.episodeNumber - b.episodeNumber;
    });

    return episodes;
  }

  /**
   * Mark an entire show or seasons as unwatched (unscrobble)
   */
  async markShowUnwatched(showRatingKey: string): Promise<boolean> {
    await this.client.get(`/:/unscrobble`, {
      params: {
        key: showRatingKey,
        identifier: 'com.plexapp.plugins.library',
      },
    });
    return true;
  }

  /**
   * Fetch all video playlists from Plex
   */
  async getPlaylists(): Promise<any[]> {
    const response = await this.client.get('/playlists?playlistType=video');
    return response.data?.MediaContainer?.Metadata || [];
  }

  /**
   * Delete a playlist by ratingKey
   */
  async deletePlaylist(playlistRatingKey: string): Promise<boolean> {
    try {
      await this.client.delete(`/playlists/${playlistRatingKey}`);
      return true;
    } catch {
      return false;
    }
  }

  /**
   * Synchronize / populate a Plex playlist with the given ordered list of episode ratingKeys.
   * If playlist already exists with playlistRatingKey, it updates it cleanly.
   */
  async syncPlaylist(
    playlistTitle: string,
    existingPlexPlaylistId: string | null,
    episodeRatingKeys: string[]
  ): Promise<{ plexPlaylistId: string; count: number }> {
    if (episodeRatingKeys.length === 0) {
      // Nothing to sync; if playlist exists, delete or leave empty
      if (existingPlexPlaylistId) {
        await this.deletePlaylist(existingPlexPlaylistId);
      }
      return { plexPlaylistId: '', count: 0 };
    }

    const machineId = await this.getMachineIdentifier();

    // If an existing playlist ID is provided, delete it to ensure exact ordered rebuild
    if (existingPlexPlaylistId) {
      await this.deletePlaylist(existingPlexPlaylistId);
    } else {
      // Also check if a playlist with this exact title already exists
      try {
        const existingList = await this.getPlaylists();
        const found = existingList.find((p: any) => p.title === playlistTitle);
        if (found) {
          await this.deletePlaylist(String(found.ratingKey));
        }
      } catch {
        // Ignore error
      }
    }

    // Step 1: Create playlist with first item
    const firstKey = episodeRatingKeys[0];
    const firstUri = `server://${machineId}/com.plexapp.plugins.library/library/metadata/${firstKey}`;

    const createRes = await this.client.post('/playlists', null, {
      params: {
        type: 'video',
        title: playlistTitle,
        smart: 0,
        uri: firstUri,
      },
    });

    const createdMetadata = createRes.data?.MediaContainer?.Metadata?.[0];
    if (!createdMetadata) {
      throw new Error(`Failed to create playlist "${playlistTitle}" on Plex server`);
    }

    const newPlaylistRatingKey = String(createdMetadata.ratingKey);

    // Step 2: Append remaining items sequentially
    for (let i = 1; i < episodeRatingKeys.length; i++) {
      const key = episodeRatingKeys[i];
      const itemUri = `server://${machineId}/com.plexapp.plugins.library/library/metadata/${key}`;
      try {
        await this.client.put(`/playlists/${newPlaylistRatingKey}/items`, null, {
          params: {
            uri: itemUri,
          },
        });
      } catch (err) {
        console.error(`Error adding episode ${key} to playlist ${newPlaylistRatingKey}:`, err);
      }
    }

    return {
      plexPlaylistId: newPlaylistRatingKey,
      count: episodeRatingKeys.length,
    };
  }
}
