import React, { useState, useEffect, useRef, useMemo } from 'react';
import { X, RefreshCw, Layers, Calendar, Clock, Film, AlertCircle } from 'lucide-react';
import { Playlist, PreviewData } from '../types';
import { api } from '../api/client';
import { VirtualList } from './VirtualList';
import { QueueDiffPanel } from './QueueDiffPanel';
import { useModalA11y } from '../hooks/useModalA11y';
import { getPosterUrl, formatDuration } from '../utils/format';

interface QueuePreviewModalProps {
  isOpen: boolean;
  onClose: () => void;
  playlist: Playlist | null;
  onSync: (id: string) => Promise<void>;
}

export const QueuePreviewModal: React.FC<QueuePreviewModalProps> = ({
  isOpen,
  onClose,
  playlist,
  onSync,
}) => {
  const dialogRef = useRef<HTMLDivElement>(null);
  const [preview, setPreview] = useState<PreviewData | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [isSyncing, setIsSyncing] = useState(false);
  const requestIdRef = useRef(0);
  const addedKeys = useMemo(() => new Set(preview?.diff?.added ?? []), [preview]);

  useEffect(() => {
    if (isOpen && playlist) {
      loadPreview(playlist.id);
    } else {
      setPreview(null);
    }
  // eslint-disable-next-line react-hooks/exhaustive-deps
    // Invalidate any in-flight request when the modal closes or switches playlist
    return () => {
      requestIdRef.current++;
    };
  }, [isOpen, playlist?.id]);

  const loadPreview = async (id: string) => {
    const requestId = ++requestIdRef.current;
    try {
      setLoading(true);
      setError(null);
      const data = await api.getPreview(id);
      if (requestId === requestIdRef.current) setPreview(data);
    } catch (err: any) {
      if (requestId === requestIdRef.current) setError(err.message || 'Failed to load preview queue');
    } finally {
      if (requestId === requestIdRef.current) setLoading(false);
    }
  };

  const handleSyncClick = async () => {
    if (!playlist) return;
    setIsSyncing(true);
    try {
      await onSync(playlist.id);
      await loadPreview(playlist.id);
    } finally {
      setIsSyncing(false);
    }
  };



  useModalA11y(dialogRef, isOpen, onClose);

  if (!isOpen || !playlist) return null;

  return (
    <div
      ref={dialogRef}
      role="dialog"
      aria-modal="true"
      aria-label="Queue preview"
      className="fixed inset-0 z-50 flex items-center justify-center p-3 sm:p-6 bg-black/80 backdrop-blur-sm animate-fade-in"
    >
      <div className="bg-[#1b1e22] border border-[#2e343b] rounded-2xl w-full max-w-4xl max-h-[88vh] flex flex-col shadow-2xl overflow-hidden">
        {/* Header */}
        <div className="px-6 py-4 border-b border-[#2e343b] flex items-center justify-between">
          <div className="flex items-center space-x-3">
            <div className="w-8 h-8 rounded-lg bg-amber-500/20 text-amber-400 flex items-center justify-center">
              <Layers className="w-4 h-4" />
            </div>
            <div>
              <h2 className="text-lg font-bold text-white flex items-center gap-2">
                Queue Preview: {playlist.name}
              </h2>
              <p className="text-xs text-gray-400">
                Calculated playback order ({preview ? preview.totalEpisodesInQueue : '...'} episodes queued)
              </p>
            </div>
          </div>
          <button
            onClick={onClose}
            className="p-1 rounded-lg text-gray-400 hover:text-white hover:bg-[#282d33] transition-colors cursor-pointer"
          >
            <X className="w-5 h-5" />
          </button>
        </div>

        {/* Content */}
        <div className="flex-1 overflow-y-auto p-4 sm:p-6 space-y-5">
          {error && (
            <div className="p-4 rounded-xl bg-red-500/10 border border-red-500/30 flex items-center gap-3 text-red-400 text-sm">
              <AlertCircle className="w-5 h-5 shrink-0" />
              <span>{error}</span>
            </div>
          )}

          {loading ? (
            <div className="h-64 flex flex-col items-center justify-center space-y-3 text-gray-400">
              <div className="w-8 h-8 border-2 border-amber-500 border-t-transparent rounded-full animate-spin"></div>
              <p className="text-sm">Calculating interleaved episode rotation...</p>
            </div>
          ) : !preview || preview.episodes.length === 0 ? (
            <div className="h-64 flex flex-col items-center justify-center text-gray-500">
              <Film className="w-12 h-12 mb-2 opacity-30" />
              <p className="text-sm">No episodes available in queue.</p>
              <p className="text-xs text-gray-500 mt-1">
                Shows may be completely watched or have no episodes available.
              </p>
            </div>
          ) : (
            <>
              {preview.diff && <QueueDiffPanel diff={preview.diff} />}

              {/* Show Distribution Stats */}
              {preview.showStats && preview.showStats.length > 0 && (
                <div className="bg-[#16181b] border border-[#2d3238] rounded-xl p-4">
                  <h4 className="text-xs font-semibold uppercase tracking-wider text-gray-400 mb-3">
                    Rotation Distribution & Pacing
                  </h4>
                  <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
                    {preview.showStats.map((stat) => {
                      const showEpisodes = preview.episodes.filter(
                        (e) => e.showRatingKey === stat.ratingKey || e.showTitle === stat.title
                      );
                      const countInQueue = showEpisodes.length;
                      const totalDurationMs = showEpisodes.reduce((acc, e) => acc + (e.duration || 0), 0);
                      const totalMinutes = Math.round(totalDurationMs / 60000);
                      const durationFormatted = totalMinutes >= 60
                        ? `${Math.floor(totalMinutes / 60)}h ${totalMinutes % 60}m`
                        : `${totalMinutes}m`;

                      const percentage =
                        preview.totalEpisodesInQueue > 0
                          ? Math.round((countInQueue / preview.totalEpisodesInQueue) * 100)
                          : 0;

                      return (
                        <div
                          key={stat.ratingKey}
                          className="bg-[#20252b] border border-[#30373f] rounded-lg p-2.5"
                        >
                          <p className="text-xs font-semibold text-gray-200 truncate">{stat.title}</p>
                          <div className="flex items-baseline justify-between mt-1 text-xs">
                            <span className="text-amber-400 font-bold font-mono">
                              {countInQueue} eps {totalMinutes > 0 && <span className="text-[10px] text-gray-400 font-normal">({durationFormatted})</span>}
                            </span>
                            <span className="text-[11px] text-gray-400">{percentage}%</span>
                          </div>
                          <div className="w-full bg-[#16181b] h-1.5 rounded-full mt-1.5 overflow-hidden">
                            <div
                              className="bg-amber-500 h-full rounded-full transition-all"
                              style={{ width: `${percentage}%` }}
                            ></div>
                          </div>
                        </div>
                      );
                    })}
                  </div>
                </div>
              )}

              {/* Episode Queue List */}
              <div className="space-y-2">
                <h4 className="text-xs font-semibold uppercase tracking-wider text-gray-400">
                  Upcoming Episode Sequence
                </h4>
                <VirtualList
                  items={preview.episodes}
                  itemHeight={56}
                  gap={8}
                  ariaLabel="Upcoming episode sequence"
                  renderItem={(ep, idx) => {
                  const posterUrl = getPosterUrl(ep.thumb);
                  return (
                    <div
                      className="h-full overflow-hidden flex items-center space-x-3 bg-[#1d2125] border border-[#2d3238] hover:border-[#3d454f] rounded-xl p-2.5 transition-colors"
                    >
                      {/* Queue sequence index */}
                      <span className="w-7 text-center font-mono text-xs font-bold text-gray-500 shrink-0">
                        #{idx + 1}
                      </span>

                      {/* Thumbnail */}
                      {posterUrl ? (
                        <img
                          src={posterUrl}
                          alt={ep.title}
                          className="w-12 h-8 object-cover rounded bg-[#252a30] shrink-0"
                          onError={(e) => {
                            (e.target as HTMLElement).style.display = 'none';
                          }}
                        />
                      ) : (
                        <div className="w-12 h-8 rounded bg-[#252a30] flex items-center justify-center shrink-0 text-[10px] text-gray-400 font-bold">
                          EP
                        </div>
                      )}

                      {/* Episode Info */}
                      <div className="min-w-0 flex-1">
                        <div className="flex items-center gap-2">
                          <span className="text-xs font-bold text-amber-400 truncate">
                            {ep.showTitle}
                          </span>
                          <span className="text-xs font-mono font-medium text-gray-400 bg-[#252a30] px-1.5 py-0.5 rounded">
                            S{String(ep.seasonNumber).padStart(2, '0')}E{String(ep.episodeNumber).padStart(2, '0')}
                          </span>
                          {addedKeys.has(ep.ratingKey) && (
                            <span className="text-[10px] font-bold uppercase tracking-wide text-emerald-400 bg-emerald-500/10 border border-emerald-500/30 px-1.5 py-0.5 rounded">
                              New
                            </span>
                          )}
                        </div>
                        <p className="text-xs text-gray-300 truncate mt-0.5">{ep.title}</p>
                      </div>

                      {/* Air date & Duration */}
                      <div className="hidden sm:flex items-center space-x-3 text-xs text-gray-400 shrink-0">
                        {ep.airDate && (
                          <div className="flex items-center space-x-1">
                            <Calendar className="w-3.5 h-3.5 text-gray-500" />
                            <span>{ep.airDate}</span>
                          </div>
                        )}
                        {ep.duration && (
                          <div className="flex items-center space-x-1">
                            <Clock className="w-3.5 h-3.5 text-gray-500" />
                            <span>{formatDuration(ep.duration)}</span>
                          </div>
                        )}
                      </div>
                    </div>
                  );
                  }}
                />
              </div>
            </>
          )}
        </div>

        {/* Footer */}
        <div className="px-6 py-4 border-t border-[#2e343b] bg-[#16181b] flex items-center justify-between">
          <button
            onClick={() => loadPreview(playlist.id)}
            disabled={loading}
            className="flex items-center space-x-1.5 text-xs text-gray-300 hover:text-white bg-[#252a30] hover:bg-[#313740] px-3.5 py-2 rounded-lg border border-[#3a414b] transition-colors cursor-pointer"
          >
            <RefreshCw className={`w-3.5 h-3.5 ${loading ? 'animate-spin' : ''}`} />
            <span>Recalculate</span>
          </button>

          <div className="flex items-center space-x-2">
            <button
              onClick={onClose}
              className="px-4 py-2 rounded-lg bg-[#272d33] hover:bg-[#343b44] text-sm text-gray-300 font-medium transition-colors cursor-pointer"
            >
              Close
            </button>
            <button
              onClick={handleSyncClick}
              disabled={isSyncing || loading || !preview || preview.episodes.length === 0}
              className="flex items-center space-x-1.5 bg-amber-500 hover:bg-amber-400 disabled:opacity-50 text-black font-semibold text-sm px-4 py-2 rounded-lg transition-colors shadow-md shadow-amber-500/10 cursor-pointer"
            >
              <RefreshCw className={`w-4 h-4 ${isSyncing ? 'animate-spin' : ''}`} />
              <span>{isSyncing ? 'Syncing to Plex...' : 'Sync to Plex Now'}</span>
            </button>
          </div>
        </div>
      </div>
    </div>
  );
};
