import React from 'react';
import { Play, Settings, History, Plus, RefreshCw, Shield, LogOut } from 'lucide-react';
import { SettingsData } from '../types';

interface NavbarProps {
  settings: SettingsData | null;
  onOpenSettings: () => void;
  onOpenLogs: () => void;
  onNewPlaylist: () => void;
  onLogout: () => void;
  hasPassword?: boolean;
}

export const Navbar: React.FC<NavbarProps> = ({
  settings,
  onOpenSettings,
  onOpenLogs,
  onNewPlaylist,
  onLogout,
  hasPassword,
}) => {
  return (
    <header className="bg-[#181a1d] border-b border-[#2d3238] sticky top-0 z-30 shadow-md">
      <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 h-16 flex items-center justify-between">
        {/* Brand */}
        <div className="flex items-center space-x-3">
          <div className="w-10 h-10 rounded-xl bg-gradient-to-br from-amber-500 to-amber-700 flex items-center justify-center shadow-lg shadow-amber-500/20 text-black font-bold">
            <Play className="w-5 h-5 fill-black stroke-black ml-0.5" />
          </div>
          <div>
            <h1 className="text-lg font-bold tracking-tight text-white flex items-center gap-2">
              Plex Playlist Creator
              <span className="text-[10px] uppercase tracking-wider bg-amber-500/20 text-amber-400 font-semibold px-2 py-0.5 rounded border border-amber-500/30">
                Proxmox LXC
              </span>
            </h1>
            <p className="text-xs text-gray-400">Automated Interleaved TV Show Rotation</p>
          </div>
        </div>

        {/* Server Status Pill & Actions */}
        <div className="flex items-center space-x-2 sm:space-x-3">
          {settings?.isConfigured ? (
            <div className="hidden md:flex items-center space-x-2 bg-[#22262b] border border-[#343b42] px-3 py-1.5 rounded-lg text-xs text-gray-300">
              <span className="w-2 h-2 rounded-full bg-emerald-400 animate-pulse"></span>
              <span className="text-gray-400">Server:</span>
              <span className="font-medium text-white">{settings.plexServerName || 'Connected'}</span>
            </div>
          ) : (
            <div className="hidden md:flex items-center space-x-2 bg-amber-500/10 border border-amber-500/30 px-3 py-1.5 rounded-lg text-xs text-amber-400">
              <span className="w-2 h-2 rounded-full bg-amber-400"></span>
              <span>Plex Not Configured</span>
            </div>
          )}

          <button
            onClick={onNewPlaylist}
            className="flex items-center space-x-1.5 bg-amber-500 hover:bg-amber-400 text-black font-semibold text-xs sm:text-sm px-3 sm:px-4 py-2 rounded-lg transition-colors shadow-md shadow-amber-500/10 cursor-pointer"
          >
            <Plus className="w-4 h-4 stroke-[2.5]" />
            <span>New Playlist</span>
          </button>

          <button
            onClick={onOpenLogs}
            title="Sync History & Logs"
            className="p-2 rounded-lg bg-[#22262b] hover:bg-[#2d3238] border border-[#343b42] text-gray-300 hover:text-white transition-colors cursor-pointer"
          >
            <History className="w-4 h-4" />
          </button>

          <button
            onClick={onOpenSettings}
            title="Settings & Plex Connection"
            className="p-2 rounded-lg bg-[#22262b] hover:bg-[#2d3238] border border-[#343b42] text-gray-300 hover:text-white transition-colors cursor-pointer"
          >
            <Settings className="w-4 h-4" />
          </button>

          {hasPassword && (
            <button
              onClick={onLogout}
              title="Sign Out"
              className="p-2 rounded-lg bg-[#22262b] hover:bg-red-500/20 border border-[#343b42] hover:border-red-500/40 text-gray-300 hover:text-red-400 transition-colors cursor-pointer"
            >
              <LogOut className="w-4 h-4" />
            </button>
          )}
        </div>
      </div>
    </header>
  );
};
