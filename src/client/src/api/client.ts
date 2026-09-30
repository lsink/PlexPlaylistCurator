import { Playlist, SettingsData, SyncLog, PreviewData, ShowItem } from '../types';

async function request<T>(url: string, options?: RequestInit): Promise<T> {
  const res = await fetch(url, {
    headers: {
      'Content-Type': 'application/json',
      ...options?.headers,
    },
    ...options,
  });

  if (!res.ok) {
    let errorMsg = `Request failed: ${res.statusText}`;
    try {
      const data = await res.json();
      if (data.error) errorMsg = data.error;
    } catch {
      // Ignore parse failure
    }
    throw new Error(errorMsg);
  }

  return res.json();
}

export const api = {
  // Auth
  getAuthStatus: () => request<{ hasPassword: boolean; isConfigured: boolean; isAuthenticated: boolean }>('/api/auth/status'),
  setupAuth: (password: string) => request<{ success: boolean }>('/api/auth/setup', {
    method: 'POST',
    body: JSON.stringify({ password }),
  }),
  login: (password: string) => request<{ success: boolean }>('/api/auth/login', {
    method: 'POST',
    body: JSON.stringify({ password }),
  }),
  logout: () => request<{ success: boolean }>('/api/auth/logout', { method: 'POST' }),

  // Settings
  getSettings: () => request<SettingsData>('/api/settings'),
  saveSettings: (data: Partial<SettingsData> & { plexToken?: string }) => request<{ success: boolean; serverName: string }>('/api/settings', {
    method: 'POST',
    body: JSON.stringify(data),
  }),
  testConnection: (plexUrl?: string, plexToken?: string) => request<{ success: boolean; info: any; libraries: any[] }>('/api/settings/test-connection', {
    method: 'POST',
    body: JSON.stringify({ plexUrl, plexToken }),
  }),

  // Plex
  getLibraries: () => request<Array<{ key: string; title: string; type: string }>>('/api/plex/libraries'),
  getShows: (sectionKey: string) => request<ShowItem[]>(`/api/plex/shows?sectionKey=${sectionKey}`),
  getShowDetails: (ratingKey: string) => request<ShowItem>(`/api/plex/shows/${ratingKey}`),
  searchShows: (q: string) => request<ShowItem[]>(`/api/plex/search?q=${encodeURIComponent(q)}`),
  unscrobbleShow: (showRatingKey: string) => request<{ success: boolean }>('/api/plex/unscrobble', {
    method: 'POST',
    body: JSON.stringify({ showRatingKey }),
  }),

  // Playlists
  getPlaylists: () => request<Playlist[]>('/api/playlists'),
  getPlaylist: (id: string) => request<Playlist>(`/api/playlists/${id}`),
  createPlaylist: (data: any) => request<{ id: string; success: boolean }>('/api/playlists', {
    method: 'POST',
    body: JSON.stringify(data),
  }),
  updatePlaylist: (id: string, data: any) => request<{ success: boolean }>(`/api/playlists/${id}`, {
    method: 'PUT',
    body: JSON.stringify(data),
  }),
  deletePlaylist: (id: string, deleteFromPlex = false) => request<{ success: boolean }>(`/api/playlists/${id}?deleteFromPlex=${deleteFromPlex}`, {
    method: 'DELETE',
  }),
  getPreview: (id: string) => request<PreviewData>(`/api/playlists/${id}/preview`),
  syncPlaylist: (id: string) => request<{ success: boolean; episodesSynced: number; plexPlaylistId: string }>(`/api/playlists/${id}/sync`, {
    method: 'POST',
  }),
  refreshPlaylistStats: (id: string) => request<{ success: boolean; shows: ShowItem[] }>(`/api/playlists/${id}/refresh-stats`, {
    method: 'POST',
  }),

  // Logs
  getLogs: () => request<SyncLog[]>('/api/logs'),
  clearLogs: () => request<{ success: boolean }>('/api/logs', { method: 'DELETE' }),
};
