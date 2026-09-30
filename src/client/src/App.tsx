import React, { useState, useEffect } from 'react';
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

export const App: React.FC = () => {
  const [playlists, setPlaylists] = useState<Playlist[]>([]);
  const [settings, setSettings] = useState<SettingsData | null>(null);
  const [authStatus, setAuthStatus] = useState<{
    hasPassword: boolean;
    isConfigured: boolean;
    isAuthenticated: boolean;
  } | null>(null);

  const [loading, setLoading] = useState(true);
  const [syncingAll, setSyncingAll] = useState(false);
  const [toastMessage, setToastMessage] = useState<{ text: string; type: 'success' | 'error' } | null>(null);

  // Modals
  const [settingsOpen, setSettingsOpen] = useState(false);
  const [logsOpen, setLogsOpen] = useState(false);
  const [editorOpen, setEditorOpen] = useState(false);
  const [previewOpen, setPreviewOpen] = useState(false);
  const [loginOpen, setLoginOpen] = useState(false);

  const [activePlaylist, setActivePlaylist] = useState<Playlist | null>(null);

  const showToast = (text: string, type: 'success' | 'error' = 'success') => {
    setToastMessage({ text, type });
    setTimeout(() => setToastMessage(null), 4000);
  };

  useEffect(() => {
    checkAuthAndLoad();
  }, []);

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

  const loadInitialData = async () => {
    try {
      const [settingsRes, playlistsRes] = await Promise.all([
        api.getSettings(),
        api.getPlaylists(),
      ]);
      setSettings(settingsRes);
      setPlaylists(playlistsRes);

      // If Plex is not yet configured, automatically prompt user
      if (!settingsRes.isConfigured || !settingsRes.plexUrl) {
        setSettingsOpen(true);
      }
    } catch (err: any) {
      console.error('Failed to load initial data:', err);
    }
  };

  const handleLoginSuccess = async () => {
    setLoginOpen(false);
    setAuthStatus((prev) => (prev ? { ...prev, isAuthenticated: true } : null));
    await loadInitialData();
  };

  const handleLogout = async () => {
    try {
      await api.logout();
      setAuthStatus((prev) => (prev ? { ...prev, isAuthenticated: false } : null));
      setLoginOpen(true);
    } catch (err) {
      console.error('Logout error:', err);
    }
  };

  const handleSyncPlaylist = async (id: string) => {
    try {
      const res = await api.syncPlaylist(id);
      showToast(`Successfully synced ${res.episodesSynced} episodes to Plex!`);
      // Reload playlists to reflect updated timestamps
      const updated = await api.getPlaylists();
      setPlaylists(updated);
    } catch (err: any) {
      showToast(err.message || 'Sync failed', 'error');
    }
  };

  const handleSyncAll = async () => {
    setSyncingAll(true);
    try {
      let total = 0;
      for (const p of playlists) {
        if (p.enabled) {
          try {
            const res = await api.syncPlaylist(p.id);
            total += res.episodesSynced;
          } catch (e) {
            console.error(`Error syncing ${p.name}:`, e);
          }
        }
      }
      showToast(`Finished syncing all playlists (${total} episodes updated)`);
      const updated = await api.getPlaylists();
      setPlaylists(updated);
    } finally {
      setSyncingAll(false);
    }
  };

  const handleSavePlaylist = async (data: any, shouldSyncNow = false) => {
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
  };

  const handleDeletePlaylist = async (playlist: Playlist) => {
    const deleteFromPlex = confirm(
      `Delete playlist "${playlist.name}"?\n\nClick OK to also remove the playlist from your Plex server.\nClick Cancel to only remove it from this app.`
    );

    try {
      await api.deletePlaylist(playlist.id, deleteFromPlex);
      showToast(`Deleted "${playlist.name}"`);
      const updated = await api.getPlaylists();
      setPlaylists(updated);
    } catch (err: any) {
      showToast(err.message || 'Failed to delete playlist', 'error');
    }
  };

  const openEditorForNew = () => {
    if (!settings?.isConfigured) {
      alert('Please connect to your Plex server in Settings first.');
      setSettingsOpen(true);
      return;
    }
    setActivePlaylist(null);
    setEditorOpen(true);
  };

  const openEditorForEdit = (playlist: Playlist) => {
    setActivePlaylist(playlist);
    setEditorOpen(true);
  };

  const openPreview = (playlist: Playlist) => {
    setActivePlaylist(playlist);
    setPreviewOpen(true);
  };

  return (
    <div className="min-h-screen bg-[#131517] text-gray-100 flex flex-col">
      <Navbar
        settings={settings}
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
                plexUrl={settings?.plexUrl}
                plexToken={settings?.plexTokenMasked ? settings.plexUrl : ''}
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
        <p>Plex Interleaved Playlist Creator • Optimized for Proxmox LXC Containers & Docker</p>
      </footer>

      {/* Modals */}
      <PlaylistEditorModal
        isOpen={editorOpen}
        onClose={() => setEditorOpen(false)}
        playlist={activePlaylist}
        onSave={handleSavePlaylist}
        onPreview={openPreview}
        plexUrl={settings?.plexUrl}
      />

      <QueuePreviewModal
        isOpen={previewOpen}
        onClose={() => setPreviewOpen(false)}
        playlist={activePlaylist}
        onSync={handleSyncPlaylist}
        plexUrl={settings?.plexUrl}
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
