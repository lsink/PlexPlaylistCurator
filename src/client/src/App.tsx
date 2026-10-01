import React, { useState, useEffect, useCallback, useRef } from 'react';
import {
  Plus,
  RefreshCw,
  Film,
  Sparkles,
  Layers,
  Server,
  AlertCircle,
  HelpCircle,
  CheckCircle2,
} from 'lucide-react';
import { Navbar } from './components/Navbar';
import { PlaylistCard } from './components/PlaylistCard';
import { PlaylistEditorModal } from './components/PlaylistEditorModal';
import { QueuePreviewModal } from './components/QueuePreviewModal';
import { SettingsModal } from './components/SettingsModal';
import { SyncLogsModal } from './components/SyncLogsModal';
import { LoginModal } from './components/LoginModal';
import { Playlist, SettingsData } from './types';
import { api } from './api/client';
import { useConfirm } from './components/ConfirmDialog';
import { useSettings } from './context/SettingsContext';

export const App: React.FC = () => {
  const [playlists, setPlaylists] = useState<Playlist[]>([]);
  const { settings, refreshSettings, clearSettings } = useSettings();
  const [authStatus, setAuthStatus] = useState<{
    hasPassword: boolean;
    isConfigured: boolean;
    isAuthenticated: boolean;
  } | null>(null);

  const [loading, setLoading] = useState(true);
  const [syncingAll, setSyncingAll] = useState(false);
  const [toastMessage, setToastMessage] = useState<{ text: string; type: 'success' | 'error' } | null>(null);
  const toastTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const confirm = useConfirm();

  // Modals
  const [settingsOpen, setSettingsOpen] = useState(false);
  const [logsOpen, setLogsOpen] = useState(false);
  const [editorOpen, setEditorOpen] = useState(false);
  const [previewOpen, setPreviewOpen] = useState(false);
  const [loginOpen, setLoginOpen] = useState(false);

  const [activePlaylist, setActivePlaylist] = useState<Playlist | null>(null);

  const showToast = useCallback((text: string, type: 'success' | 'error' = 'success') => {
    // Cancel any existing toast timer
    if (toastTimerRef.current) {
      clearTimeout(toastTimerRef.current);
    }
    setToastMessage({ text, type });
    toastTimerRef.current = setTimeout(() => {
      setToastMessage(null);
      toastTimerRef.current = null;
    }, 4000);
  }, []);

  useEffect(() => {
    checkAuthAndLoad();
    // Clear toast timer on unmount
    return () => {
      if (toastTimerRef.current) clearTimeout(toastTimerRef.current);
    };
  }, []);

  // Session expired while the app was open (any API call returned 401)
  useEffect(() => {
    const onExpired = () => {
      setAuthStatus((prev) => (prev ? { ...prev, isAuthenticated: false } : prev));
      clearSettings();
      setLoginOpen(true);
    };
    window.addEventListener('auth-expired', onExpired);
    return () => window.removeEventListener('auth-expired', onExpired);
  }, [clearSettings]);

  const checkAuthAndLoad = async () => {
    try {
      setLoading(true);
      const auth = await api.getAuthStatus();
      setAuthStatus(auth);

      if (auth.hasPassword && !auth.isAuthenticated) {
        setLoginOpen(true);
        setLoading(false);
        return;
      }

      await loadInitialData();
    } catch (err: any) {
      console.error('Initialization error:', err);
    } finally {
      setLoading(false);
    }
  };

  const loadInitialData = useCallback(async () => {
    try {
      const [settingsRes, playlistsRes] = await Promise.all([
        refreshSettings(),
        api.getPlaylists(),
      ]);
      setPlaylists(playlistsRes);

      // If Plex is not yet configured, automatically prompt user
      if (!settingsRes.isConfigured || !settingsRes.plexUrl) {
        setSettingsOpen(true);
      }
    } catch (err: any) {
      console.error('Failed to load initial data:', err);
      // If session expired (401), re-prompt login
      if (err?.status === 401) {
        setLoginOpen(true);
      }
    }
  }, [refreshSettings]);

  const handleLoginSuccess = useCallback(async () => {
    setLoginOpen(false);
    setAuthStatus((prev) => (prev ? { ...prev, isAuthenticated: true } : null));
    await loadInitialData();
  }, [loadInitialData]);

  const handleLogout = useCallback(async () => {
    try {
      await api.logout();
      clearSettings();
      setAuthStatus((prev) => (prev ? { ...prev, isAuthenticated: false } : null));
      setLoginOpen(true);
    } catch (err) {
      console.error('Logout error:', err);
    }
  }, [clearSettings]);

  const handleSyncPlaylist = useCallback(async (id: string) => {
    try {
      const res = await api.syncPlaylist(id);
      showToast(
        res.unchanged
          ? `Already up to date: Plex has the same ${res.episodesSynced} episodes`
          : `Successfully synced ${res.episodesSynced} episodes to Plex!`
      );
      // Reload playlists to reflect updated timestamps
      const updated = await api.getPlaylists();
      setPlaylists(updated);
    } catch (err: any) {
      showToast(err.message || 'Sync failed', 'error');
    }
  }, [showToast]);

  const handleSyncAll = useCallback(async () => {
    setSyncingAll(true);
    try {
      const { synced, failed } = await api.syncAllPlaylists();
      const msg = failed > 0
        ? `Sync done: ${synced} playlist(s) updated, ${failed} failed`
        : `Finished syncing ${synced} playlist(s)`;
      showToast(msg, failed > 0 ? 'error' : 'success');
    } catch (err: any) {
      showToast(err.message || 'Sync failed', 'error');
    } finally {
      try {
        setPlaylists(await api.getPlaylists());
      } catch {
        // Keep the list we have if the refresh fails
      }
      setSyncingAll(false);
    }
  }, [showToast]);

  // Errors propagate to PlaylistEditorModal, which shows them inline and stays open
  const handleSavePlaylist = useCallback(async (data: any, shouldSyncNow = false) => {
    if (activePlaylist) {
      // Update
      await api.updatePlaylist(activePlaylist.id, data);
      if (shouldSyncNow) {
        await api.syncPlaylist(activePlaylist.id);
      }
      showToast(`Updated "${data.name}"`);
    } else {
      // Create
      const res = await api.createPlaylist(data);
      if (shouldSyncNow && res.id) {
        await api.syncPlaylist(res.id);
      }
      showToast(`Created "${data.name}"`);
    }

    const updated = await api.getPlaylists();
    setPlaylists(updated);
  }, [activePlaylist, showToast]);

  const handleDeletePlaylist = useCallback(async (playlist: Playlist) => {
    const choice = await confirm({
      title: `Delete "${playlist.name}"?`,
      message: 'Choose whether to also remove the playlist from your Plex server, or only from this app.',
      confirmLabel: 'Delete and remove from Plex',
      secondaryLabel: 'Delete from app only',
      destructive: true,
    });
    if (choice === 'cancel') return;
    const deleteFromPlex = choice === 'confirm';

    try {
      await api.deletePlaylist(playlist.id, deleteFromPlex);
      showToast(`Deleted "${playlist.name}"`);
      const updated = await api.getPlaylists();
      setPlaylists(updated);
    } catch (err: any) {
      showToast(err.message || 'Failed to delete playlist', 'error');
    }
  }, [confirm, showToast]);

  const openEditorForNew = useCallback(() => {
    if (!settings?.isConfigured) {
      confirm({
        title: 'Connect to Plex first',
        message: 'Please connect to your Plex server in Settings before creating a playlist.',
        confirmLabel: 'Open Settings',
        hideCancel: true,
      }).then(() => setSettingsOpen(true));
      return;
    }
    setActivePlaylist(null);
    setEditorOpen(true);
  }, [settings?.isConfigured, confirm]);

  const openEditorForEdit = useCallback((playlist: Playlist) => {
    setActivePlaylist(playlist);
    setEditorOpen(true);
  }, []);

  const openPreview = useCallback((playlist: Playlist) => {
    setActivePlaylist(playlist);
    setPreviewOpen(true);
  }, []);

  return (
    <div className="min-h-screen bg-[#131517] text-gray-100 flex flex-col">
      <Navbar
        onOpenSettings={() => setSettingsOpen(true)}
        onOpenLogs={() => setLogsOpen(true)}
        onNewPlaylist={openEditorForNew}
        onLogout={handleLogout}
        hasPassword={authStatus?.hasPassword}
      />

      {/* Toast Notification */}
      {toastMessage && (
        <div className="fixed bottom-6 right-6 z-50 animate-bounce-short">
          <div
            className={`px-4 py-3 rounded-xl shadow-xl flex items-center gap-2.5 text-xs font-semibold ${
              toastMessage.type === 'success'
                ? 'bg-emerald-500 text-black shadow-emerald-500/20'
                : 'bg-red-500 text-white shadow-red-500/20'
            }`}
          >
            {toastMessage.type === 'success' ? (
              <CheckCircle2 className="w-4 h-4" />
            ) : (
              <AlertCircle className="w-4 h-4" />
            )}
            <span>{toastMessage.text}</span>
          </div>
        </div>
      )}

      {/* Main Container */}
      <main className="flex-1 max-w-7xl w-full mx-auto px-4 sm:px-6 lg:px-8 py-8">
        {/* Banner if Plex is not yet connected */}
        {settings && !settings.isConfigured && (
          <div className="mb-8 bg-gradient-to-r from-amber-500/15 via-amber-500/10 to-transparent border border-amber-500/30 rounded-2xl p-5 sm:p-6 flex flex-col sm:flex-row items-start sm:items-center justify-between gap-4">
            <div className="flex items-center space-x-3.5">
              <div className="w-12 h-12 rounded-xl bg-amber-500 text-black flex items-center justify-center font-bold shrink-0 shadow-lg shadow-amber-500/20">
                <Server className="w-6 h-6" />
              </div>
              <div>
                <h3 className="text-base font-bold text-white">Connect Your Plex Media Server</h3>
                <p className="text-xs text-gray-300 mt-0.5">
                  Enter your Plex IP address and authentication token to load your TV libraries and start curating playlists.
                </p>
              </div>
            </div>
            <button
              onClick={() => setSettingsOpen(true)}
              className="bg-amber-500 hover:bg-amber-400 text-black font-semibold text-xs sm:text-sm px-4 py-2.5 rounded-xl transition-colors shadow-md shadow-amber-500/15 shrink-0 cursor-pointer"
            >
              Configure Plex
            </button>
          </div>
        )}

        {/* Dashboard Header & Controls */}
        <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4 mb-6">
          <div>
            <h2 className="text-xl font-bold text-white tracking-tight">Curated Rotations</h2>
            <p className="text-xs text-gray-400 mt-0.5">
              Sequential, interleaved TV playlists automatically synced with your Plex watch status.
            </p>
          </div>

          {playlists.length > 0 && (
            <div className="flex items-center space-x-2.5">
              <button
                onClick={handleSyncAll}
                disabled={syncingAll}
                className="flex items-center space-x-1.5 bg-[#20252b] hover:bg-[#2c333a] border border-[#343b43] text-gray-200 text-xs font-semibold px-3.5 py-2 rounded-xl transition-colors cursor-pointer disabled:opacity-50"
              >
                <RefreshCw className={`w-3.5 h-3.5 ${syncingAll ? 'animate-spin' : ''}`} />
                <span>{syncingAll ? 'Syncing All...' : 'Sync All Playlists'}</span>
              </button>

              <button
                onClick={openEditorForNew}
                className="flex items-center space-x-1.5 bg-amber-500 hover:bg-amber-400 text-black text-xs font-bold px-4 py-2 rounded-xl transition-colors shadow-md shadow-amber-500/10 cursor-pointer"
              >
                <Plus className="w-3.5 h-3.5 stroke-[2.5]" />
                <span>New Playlist</span>
              </button>
            </div>
          )}
        </div>

        {/* Playlists Grid */}
        {loading ? (
          <div className="h-72 flex flex-col items-center justify-center space-y-3 text-gray-400">
            <div className="w-8 h-8 border-2 border-amber-500 border-t-transparent rounded-full animate-spin"></div>
            <p className="text-sm">Loading playlists...</p>
          </div>
        ) : playlists.length === 0 ? (
          <div className="bg-[#181b1f] border border-[#272c33] rounded-2xl p-8 sm:p-12 text-center max-w-2xl mx-auto my-8">
            <div className="w-16 h-16 rounded-2xl bg-amber-500/15 border border-amber-500/30 text-amber-400 flex items-center justify-center mx-auto mb-4">
              <Sparkles className="w-8 h-8" />
            </div>
            <h3 className="text-lg font-bold text-white mb-2">No Playlists Created Yet</h3>
            <p className="text-xs text-gray-400 max-w-md mx-auto mb-6 leading-relaxed">
              Create an interleaved playlist by picking two or more TV shows from your Plex library.
              Episodes are organized sequentially in a balanced rotation so you can watch in order without getting bored of a single show!
            </p>
            <button
              onClick={openEditorForNew}
              className="inline-flex items-center space-x-2 bg-amber-500 hover:bg-amber-400 text-black font-semibold text-sm px-5 py-2.5 rounded-xl transition-colors shadow-lg shadow-amber-500/15 cursor-pointer"
            >
              <Plus className="w-4 h-4 stroke-[2.5]" />
              <span>Create First Playlist</span>
            </button>
          </div>
        ) : (
          <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
            {playlists.map((playlist) => (
              <PlaylistCard
                key={playlist.id}
                playlist={playlist}
                onSync={handleSyncPlaylist}
                onPreview={openPreview}
                onEdit={openEditorForEdit}
                onDelete={handleDeletePlaylist}
              />
            ))}
          </div>
        )}
      </main>

      {/* Footer */}
      <footer className="bg-[#141618] border-t border-[#25292e] py-4 text-center text-xs text-gray-500">
        <p>Plex Playlist Curator v{settings?.appVersion || '1.0.0'} &bull; Optimized for Proxmox LXC &amp; Docker</p>
      </footer>

      {/* Modals */}
      <PlaylistEditorModal
        isOpen={editorOpen}
        onClose={() => setEditorOpen(false)}
        playlist={activePlaylist}
        onSave={handleSavePlaylist}
        onPreview={openPreview}
      />

      <QueuePreviewModal
        isOpen={previewOpen}
        onClose={() => setPreviewOpen(false)}
        playlist={activePlaylist}
        onSync={handleSyncPlaylist}
      />

      <SettingsModal
        isOpen={settingsOpen}
        onClose={() => setSettingsOpen(false)}
        onSaved={loadInitialData}
      />

      <SyncLogsModal
        isOpen={logsOpen}
        onClose={() => setLogsOpen(false)}
      />

      <LoginModal
        isOpen={loginOpen}
        onSuccess={handleLoginSuccess}
      />
    </div>
  );
};

export default App;
