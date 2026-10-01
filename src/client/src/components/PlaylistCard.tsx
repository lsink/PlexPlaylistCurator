import React, { useState } from 'react';
import {
  Play,
  RefreshCw,
  Eye,
  Edit2,
  Trash2,
  Clock,
  Layers,
  Scale,
  Sparkles,
  Calendar,
  CheckCircle2,
  AlertCircle,
} from 'lucide-react';
import { Playlist, InterleaveMode } from '../types';
import { getPosterUrl, parseDbTimestamp, formatFinish, formatPace } from '../utils/format';

interface PlaylistCardProps {
  playlist: Playlist;
  onSync: (id: string) => Promise<void>;
  onPreview: (playlist: Playlist) => void;
  onEdit: (playlist: Playlist) => void;
  onDelete: (playlist: Playlist) => void;
}

const PlaylistCardComponent: React.FC<PlaylistCardProps> = ({
  playlist,
  onSync,
  onPreview,
  onEdit,
  onDelete,
}) => {
  const [isSyncing, setIsSyncing] = useState(false);

  const handleSyncClick = async () => {
    setIsSyncing(true);
    try {
      await onSync(playlist.id);
    } finally {
      setIsSyncing(false);
    }
  };

  const renderModeBadge = (mode: InterleaveMode) => {
    switch (mode) {
      case 'auto_proportional':
        return (
          <span className="inline-flex items-center gap-1 px-2.5 py-1 rounded-full text-xs font-medium bg-amber-500/15 text-amber-300 border border-amber-500/30">
            <Sparkles className="w-3 h-3" />
            Auto-Proportional Pacing
          </span>
        );
      case 'manual_weighted':
        return (
          <span className="inline-flex items-center gap-1 px-2.5 py-1 rounded-full text-xs font-medium bg-blue-500/15 text-blue-300 border border-blue-500/30">
            <Scale className="w-3 h-3" />
            Manual Weighted
          </span>
        );
      case 'chronological':
        return (
          <span className="inline-flex items-center gap-1 px-2.5 py-1 rounded-full text-xs font-medium bg-emerald-500/15 text-emerald-300 border border-emerald-500/30">
            <Calendar className="w-3 h-3" />
            Chronological Air Date
          </span>
        );
      case 'runtime_balanced':
        return (
          <span className="inline-flex items-center gap-1 px-2.5 py-1 rounded-full text-xs font-medium bg-cyan-500/15 text-cyan-300 border border-cyan-500/30">
            <Clock className="w-3 h-3" />
            Runtime-Balanced (Watch Time)
          </span>
        );
      case 'round_robin':
      default:
        return (
          <span className="inline-flex items-center gap-1 px-2.5 py-1 rounded-full text-xs font-medium bg-purple-500/15 text-purple-300 border border-purple-500/30">
            <Layers className="w-3 h-3" />
            Pure Round-Robin (1:1)
          </span>
        );
    }
  };


  return (
    <div className="bg-[#1e2226] border border-[#2f353c] hover:border-[#414952] rounded-xl p-5 shadow-lg transition-all flex flex-col justify-between">
      {/* Top Header */}
      <div>
        <div className="flex items-start justify-between gap-3 mb-3">
          <div>
            <h3 className="text-base sm:text-lg font-bold text-white flex items-center gap-2">
              {playlist.name}
              {playlist.enabled ? (
                <span className="w-2 h-2 rounded-full bg-emerald-400" title="Active"></span>
              ) : (
                <span className="w-2 h-2 rounded-full bg-gray-500" title="Disabled"></span>
              )}
            </h3>
            <p className="text-xs text-gray-400 mt-0.5">
              Plex Playlist: <span className="text-gray-300 font-mono font-medium">{playlist.plex_playlist_title}</span>
            </p>
          </div>
          <div className="flex items-center space-x-1">
            <button
              onClick={() => onPreview(playlist)}
              title="Preview Interleaved Queue"
              className="p-1.5 rounded-lg bg-[#272d33] hover:bg-[#343b44] text-gray-300 hover:text-white transition-colors cursor-pointer"
            >
              <Eye className="w-4 h-4" />
            </button>
            <button
              onClick={() => onEdit(playlist)}
              title="Edit Playlist"
              className="p-1.5 rounded-lg bg-[#272d33] hover:bg-[#343b44] text-gray-300 hover:text-amber-400 transition-colors cursor-pointer"
            >
              <Edit2 className="w-4 h-4" />
            </button>
            <button
              onClick={() => onDelete(playlist)}
              title="Delete Playlist"
              className="p-1.5 rounded-lg bg-[#272d33] hover:bg-red-500/20 text-gray-300 hover:text-red-400 transition-colors cursor-pointer"
            >
              <Trash2 className="w-4 h-4" />
            </button>
          </div>
        </div>

        {/* Badges & Mode */}
        <div className="flex flex-wrap items-center gap-2 mb-4">
          {renderModeBadge(playlist.mode)}
          <span className="px-2 py-0.5 rounded text-xs bg-[#292f36] text-gray-300 border border-[#3b434d]">
            {playlist.buffer_size > 0 ? `Rolling ${playlist.buffer_size} eps` : 'Full Queue'}
          </span>
          {(() => {
            const minC = playlist.minConsecutiveEpisodes || playlist.consecutiveEpisodes || 1;
            const maxC = playlist.maxConsecutiveEpisodes || minC;
            if (minC === 1 && maxC === 1) return null;
            const label = minC === maxC ? `${minC} in a row` : `${minC}–${maxC} in a row`;
            return (
              <span className="px-2 py-0.5 rounded text-xs bg-indigo-500/15 text-indigo-300 border border-indigo-500/30 font-medium">
                {label}
              </span>
            );
          })()}
          {playlist.unwatchedOnly && (
            <span className="px-2 py-0.5 rounded text-xs bg-[#292f36] text-amber-300/90 border border-[#3b434d]">
              Unwatched Only
            </span>
          )}
        </div>

        {/* Shows in Rotation */}
        <div className="mb-5">
          <p className="text-xs font-semibold uppercase tracking-wider text-gray-400 mb-2">
            Rotation Shows ({playlist.shows.length})
          </p>
          {playlist.shows.length === 0 ? (
            <p className="text-xs text-gray-500 italic">No shows added yet. Click edit to select shows.</p>
          ) : (
            <div className="grid grid-cols-2 sm:grid-cols-3 gap-2">
              {playlist.shows.map((show, idx) => {
                const posterUrl = getPosterUrl(show.thumb);
                return (
                  <div
                    key={show.id || `${show.ratingKey}-${idx}`}
                    className="flex items-center space-x-2 bg-[#16181b] border border-[#2d3238] rounded-lg p-1.5 overflow-hidden"
                  >
                    {posterUrl ? (
                      <img
                        src={posterUrl}
                        alt={show.title}
                        className="w-7 h-10 object-cover rounded bg-[#252a30] shrink-0"
                        onError={(e) => {
                          // Hide broken image
                          (e.target as HTMLElement).style.display = 'none';
                        }}
                      />
                    ) : (
                      <div className="w-7 h-10 rounded bg-[#252a30] flex items-center justify-center shrink-0 text-[10px] text-gray-400 font-bold">
                        {show.title.slice(0, 2).toUpperCase()}
                      </div>
                    )}
                    <div className="min-w-0 flex-1">
                      <p className="text-xs font-medium text-gray-200 truncate">{show.title}</p>
                      {(playlist.mode === 'manual_weighted' || (playlist.mode === 'runtime_balanced' && (show.manualWeight || 1) > 1)) && (
                        <p className="text-[10px] text-amber-400 font-mono">
                          Weight: {show.manualWeight || 1}x
                        </p>
                      )}
                      {formatFinish(show.estimatedFinish) && (
                        <p
                          className={`text-[10px] ${show.estimatedFinish === 'done' ? 'text-emerald-400' : 'text-gray-400'}`}
                          title="Estimated from your watching pace and this playlist's rotation"
                        >
                          {formatFinish(show.estimatedFinish)}
                        </p>
                      )}
                    </div>
                  </div>
                );
              })}
            </div>
          )}
          {playlist.unwatchedOnly && playlist.shows.length > 0 && playlist.last_synced_at && (
            <p className="text-[11px] text-gray-500 mt-2">
              {playlist.watchRate
                ? (() => {
                    const dates = playlist.shows
                      .map((s) => s.estimatedFinish)
                      .filter((d): d is string => !!d && d !== 'done')
                      .sort();
                    const last = dates.length > 0 ? formatFinish(dates[dates.length - 1]) : null;
                    return `Your pace: ${formatPace(playlist.watchRate)} over the last 4 weeks${last ? ` · all shows ${last.replace(/^Done/, 'done')}` : ''}`;
                  })()
                : 'Finish estimates appear once you have watched a few episodes of these shows in the last 4 weeks.'}
            </p>
          )}
        </div>
      </div>

      {/* Footer Info & Sync Action */}
      <div className="pt-4 border-t border-[#292f36] flex items-center justify-between text-xs text-gray-400">
        <div className="flex items-center gap-1.5">
          {playlist.last_sync_status === 'success' ? (
            <CheckCircle2 className="w-3.5 h-3.5 text-emerald-400" />
          ) : playlist.last_sync_status === 'error' ? (
            <AlertCircle className="w-3.5 h-3.5 text-red-400" />
          ) : (
            <Clock className="w-3.5 h-3.5 text-gray-500" />
          )}
          <span>
            {playlist.last_synced_at
              ? `Synced ${parseDbTimestamp(playlist.last_synced_at).toLocaleDateString()} ${parseDbTimestamp(
                  playlist.last_synced_at
                ).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}`
              : 'Never synced'}
          </span>
        </div>

        <button
          onClick={handleSyncClick}
          disabled={isSyncing || playlist.shows.length === 0}
          className="flex items-center space-x-1.5 bg-amber-500 hover:bg-amber-400 disabled:opacity-50 text-black font-semibold px-3 py-1.5 rounded-lg transition-colors shadow shadow-amber-500/10 cursor-pointer"
        >
          <RefreshCw className={`w-3.5 h-3.5 ${isSyncing ? 'animate-spin' : ''}`} />
          <span>{isSyncing ? 'Syncing...' : 'Sync to Plex'}</span>
        </button>
      </div>
    </div>
  );
};

export const PlaylistCard = React.memo(PlaylistCardComponent);
