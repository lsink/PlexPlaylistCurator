import React, { useState, useEffect, useRef } from 'react';
import {
  X,
  Plus,
  Trash2,
  ArrowUp,
  ArrowDown,
  Sparkles,
  Layers,
  Scale,
  Calendar,
  RotateCcw,
  Check,
  Eye,
  Sliders,
  Clock,
} from 'lucide-react';
import { Playlist, ShowItem, InterleaveMode } from '../types';
import { ShowPickerModal } from './ShowPickerModal';
import { api } from '../api/client';
import { useModalA11y } from '../hooks/useModalA11y';
import { getPosterUrl } from '../utils/format';
import { useConfirm } from './ConfirmDialog';

interface PlaylistEditorModalProps {
  isOpen: boolean;
  onClose: () => void;
  playlist: Playlist | null;
  onSave: (data: any, shouldSyncNow?: boolean) => Promise<void>;
  onPreview: (playlist: Playlist) => void;
}

export const PlaylistEditorModal: React.FC<PlaylistEditorModalProps> = ({
  isOpen,
  onClose,
  playlist,
  onSave,
  onPreview,
}) => {
  const dialogRef = useRef<HTMLDivElement>(null);
  const [name, setName] = useState('');
  const [plexPlaylistTitle, setPlexPlaylistTitle] = useState('');
  const [mode, setMode] = useState<InterleaveMode>('auto_proportional');
  const [bufferSize, setBufferSize] = useState(30);
  const [unwatchedOnly, setUnwatchedOnly] = useState(true);
  const [includeSpecials, setIncludeSpecials] = useState(false);
  const [minConsecutive, setMinConsecutive] = useState(1);
  const [maxConsecutive, setMaxConsecutive] = useState(1);
  const [enabled, setEnabled] = useState(true);
  const [shows, setShows] = useState<ShowItem[]>([]);
  const [showPickerOpen, setShowPickerOpen] = useState(false);
  const [unscrobblingKey, setUnscrobblingKey] = useState<string | null>(null);
  const [unscrobbledSuccessKey, setUnscrobbledSuccessKey] = useState<string | null>(null);
  const [isSaving, setIsSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const confirm = useConfirm();

  useEffect(() => {
    let cancelled = false;
    if (isOpen) {
      if (playlist) {
        setName(playlist.name);
        setPlexPlaylistTitle(playlist.plex_playlist_title);
        setMode(playlist.mode);
        setBufferSize(playlist.buffer_size);
        setUnwatchedOnly(playlist.unwatchedOnly);
        setIncludeSpecials(playlist.includeSpecials ?? true);
        const minVal = playlist.minConsecutiveEpisodes || playlist.consecutiveEpisodes || 1;
        const maxVal = playlist.maxConsecutiveEpisodes || minVal;
        setMinConsecutive(minVal);
        setMaxConsecutive(maxVal);
        setEnabled(playlist.enabled);
        setShows([...playlist.shows]);

        // Auto-refresh stats if any show has missing episode/unwatched counts
        const hasMissingStats = playlist.shows.some(
          (s) => s.unwatchedEpisodes === undefined || s.unwatchedEpisodes === null
        );
        if (hasMissingStats && playlist.id) {
          api.refreshPlaylistStats(playlist.id).then((res) => {
            if (!cancelled && res.shows && res.shows.length > 0) {
              setShows(res.shows);
            }
          }).catch(() => {});
        }
      } else {
        setName('');
        setPlexPlaylistTitle('');
        setMode('auto_proportional');
        setBufferSize(30);
        setUnwatchedOnly(true);
        setIncludeSpecials(false);
        setMinConsecutive(1);
        setMaxConsecutive(1);
        setEnabled(true);
        setShows([]);
      }
      setError(null);
    }
    return () => {
      cancelled = true;
    };
  }, [isOpen, playlist]);

  const handleNameChange = (val: string) => {
    setName(val);
    if (!playlist) {
      // Auto-populate Plex playlist title if creating new
      setPlexPlaylistTitle(val);
    }
  };

  const handleAddShows = (newShows: ShowItem[]) => {
    const formatted = newShows.map((s, idx) => ({
      ...s,
      sortOrder: shows.length + idx,
      manualWeight: 1,
    }));
    setShows([...shows, ...formatted]);
  };

  const handleRemoveShow = (index: number) => {
    setShows(shows.filter((_, idx) => idx !== index));
  };

  const handleMoveShow = (index: number, direction: 'up' | 'down') => {
    const targetIndex = direction === 'up' ? index - 1 : index + 1;
    if (targetIndex < 0 || targetIndex >= shows.length) return;

    const updated = [...shows];
    const temp = updated[index];
    updated[index] = updated[targetIndex];
    updated[targetIndex] = temp;
    setShows(updated);
  };

  const handleWeightChange = (index: number, val: number) => {
    const updated = [...shows];
    updated[index] = { ...updated[index], manualWeight: Math.max(1, Math.min(20, val)) };
    setShows(updated);
  };

  const handleMarkUnwatched = async (showRatingKey: string) => {
    const choice = await confirm({
      title: 'Mark show as unwatched?',
      message: 'All episodes of this TV show will be marked as unwatched in Plex.',
      confirmLabel: 'Mark unwatched',
    });
    if (choice !== 'confirm') return;

    try {
      setUnscrobblingKey(showRatingKey);
      await api.unscrobbleShow(showRatingKey);
      setUnscrobbledSuccessKey(showRatingKey);
      setShows((prev) =>
        prev.map((s) =>
          s.ratingKey === showRatingKey
            ? { ...s, unwatchedEpisodes: s.totalEpisodes ?? s.unwatchedEpisodes }
            : s
        )
      );
      setTimeout(() => setUnscrobbledSuccessKey(null), 3000);
    } catch (err: any) {
      setError(`Failed to mark show as unwatched: ${err.message}`);
    } finally {
      setUnscrobblingKey(null);
    }
  };

  const handleSubmit = async (syncNow = false) => {
    if (!name.trim()) {
      setError('Please provide a playlist name.');
      return;
    }
    if (shows.length === 0) {
      setError('Please add at least one TV show to the rotation.');
      return;
    }

    setIsSaving(true);
    setError(null);
    try {
      const payload = {
        name: name.trim(),
        plexPlaylistTitle: plexPlaylistTitle.trim() || name.trim(),
        mode,
        bufferSize: Number(bufferSize),
        unwatchedOnly,
        includeSpecials,
        consecutiveEpisodes: Number(minConsecutive) || 1,
        minConsecutiveEpisodes: Number(minConsecutive) || 1,
        maxConsecutiveEpisodes: Math.max(Number(minConsecutive) || 1, Number(maxConsecutive) || 1),
        enabled,
        shows: shows.map((s, idx) => ({
          ratingKey: s.ratingKey,
          title: s.title,
          thumb: s.thumb,
          seasonCount: s.seasonCount,
          totalEpisodes: s.totalEpisodes,
          unwatchedEpisodes: s.unwatchedEpisodes,
          sortOrder: idx,
          manualWeight: s.manualWeight || 1,
        })),
      };

      await onSave(payload, syncNow);
      onClose();
    } catch (err: any) {
      setError(err.message || 'Failed to save playlist.');
    } finally {
      setIsSaving(false);
    }
  };


  useModalA11y(dialogRef, isOpen, onClose);

  if (!isOpen) return null;

  return (
    <>
      <div
      ref={dialogRef}
      role="dialog"
      aria-modal="true"
      aria-label="Playlist editor"
      className="fixed inset-0 z-40 flex items-center justify-center p-3 sm:p-6 bg-black/80 backdrop-blur-sm animate-fade-in"
    >
        <div className="bg-[#1b1e22] border border-[#2e343b] rounded-2xl w-full max-w-3xl max-h-[90vh] flex flex-col shadow-2xl overflow-hidden">
          {/* Header */}
          <div className="px-6 py-4 border-b border-[#2e343b] flex items-center justify-between">
            <h2 className="text-lg font-bold text-white flex items-center gap-2">
              {playlist ? 'Edit Interleaved Playlist' : 'Create Interleaved Playlist'}
            </h2>
            <button
              onClick={onClose}
              className="p-1 rounded-lg text-gray-400 hover:text-white hover:bg-[#282d33] transition-colors cursor-pointer"
            >
              <X className="w-5 h-5" />
            </button>
          </div>

          {/* Form Content */}
          <div className="flex-1 overflow-y-auto p-6 space-y-6">
            {error && (
              <div className="p-3.5 rounded-xl bg-red-500/10 border border-red-500/30 text-red-400 text-sm">
                {error}
              </div>
            )}

            {/* Names */}
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
              <div>
                <label className="block text-xs font-semibold uppercase tracking-wider text-gray-400 mb-1.5">
                  App Playlist Name <span className="text-amber-500">*</span>
                </label>
                <input
                  type="text"
                  value={name}
                  onChange={(e) => handleNameChange(e.target.value)}
                  placeholder="e.g. Comedy Prime Time"
                  className="w-full bg-[#22262b] border border-[#343b42] text-white rounded-lg px-3.5 py-2.5 text-sm focus:outline-none focus:border-amber-500"
                />
              </div>

              <div>
                <label className="block text-xs font-semibold uppercase tracking-wider text-gray-400 mb-1.5">
                  Plex Target Playlist Name <span className="text-amber-500">*</span>
                </label>
                <input
                  type="text"
                  value={plexPlaylistTitle}
                  onChange={(e) => setPlexPlaylistTitle(e.target.value)}
                  placeholder="e.g. Comedy Prime Time"
                  className="w-full bg-[#22262b] border border-[#343b42] text-white rounded-lg px-3.5 py-2.5 text-sm focus:outline-none focus:border-amber-500"
                />
              </div>
            </div>

            {/* Interleaving Mode Selection */}
            <div>
              <label className="block text-xs font-semibold uppercase tracking-wider text-gray-400 mb-2">
                Interleaving & Pacing Strategy
              </label>
              <div role="radiogroup" aria-label="Interleaving and pacing strategy" className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                {/* Auto-Proportional */}
                <div
                  role="radio"
                  aria-checked={mode === 'auto_proportional'}
                  tabIndex={0}
                  onClick={() => setMode('auto_proportional')}
                  onKeyDown={(e) => {
                    if (e.key === 'Enter' || e.key === ' ') {
                      e.preventDefault();
                      setMode('auto_proportional');
                    }
                  }}
                  className={`p-3.5 rounded-xl border transition-all cursor-pointer ${
                    mode === 'auto_proportional'
                      ? 'border-amber-500 bg-amber-500/10 ring-1 ring-amber-500/40'
                      : 'border-[#2e343b] hover:border-[#424953] bg-[#22262b]'
                  }`}
                >
                  <div className="flex items-center space-x-2 font-semibold text-sm text-white mb-1">
                    <Sparkles className="w-4 h-4 text-amber-400" />
                    <span>Auto-Proportional Pacing</span>
                  </div>
                  <p className="text-xs text-gray-400">
                    Calculates weights from remaining episode counts so shorter shows don't burn out right away. Smoothly spaces episodes across the playlist.
                  </p>
                </div>

                {/* Pure Round Robin */}
                <div
                  role="radio"
                  aria-checked={mode === 'round_robin'}
                  tabIndex={0}
                  onClick={() => setMode('round_robin')}
                  onKeyDown={(e) => {
                    if (e.key === 'Enter' || e.key === ' ') {
                      e.preventDefault();
                      setMode('round_robin');
                    }
                  }}
                  className={`p-3.5 rounded-xl border transition-all cursor-pointer ${
                    mode === 'round_robin'
                      ? 'border-amber-500 bg-amber-500/10 ring-1 ring-amber-500/40'
                      : 'border-[#2e343b] hover:border-[#424953] bg-[#22262b]'
                  }`}
                >
                  <div className="flex items-center space-x-2 font-semibold text-sm text-white mb-1">
                    <Layers className="w-4 h-4 text-purple-400" />
                    <span>Pure Round-Robin (1:1:1)</span>
                  </div>
                  <p className="text-xs text-gray-400">
                    Takes strictly 1 episode from each show in rotation cycle (Show A &rarr; Show B &rarr; Show C &rarr; Show A).
                  </p>
                </div>

                {/* Manual Weighted */}
                <div
                  role="radio"
                  aria-checked={mode === 'manual_weighted'}
                  tabIndex={0}
                  onClick={() => setMode('manual_weighted')}
                  onKeyDown={(e) => {
                    if (e.key === 'Enter' || e.key === ' ') {
                      e.preventDefault();
                      setMode('manual_weighted');
                    }
                  }}
                  className={`p-3.5 rounded-xl border transition-all cursor-pointer ${
                    mode === 'manual_weighted'
                      ? 'border-amber-500 bg-amber-500/10 ring-1 ring-amber-500/40'
                      : 'border-[#2e343b] hover:border-[#424953] bg-[#22262b]'
                  }`}
                >
                  <div className="flex items-center space-x-2 font-semibold text-sm text-white mb-1">
                    <Scale className="w-4 h-4 text-blue-400" />
                    <span>Manual Weighted Override</span>
                  </div>
                  <p className="text-xs text-gray-400">
                    Assign custom frequency multipliers to shows (e.g. 2 sitcoms for every 1 drama) with smooth spacing.
                  </p>
                </div>

                {/* Chronological Air Date */}
                <div
                  role="radio"
                  aria-checked={mode === 'chronological'}
                  tabIndex={0}
                  onClick={() => setMode('chronological')}
                  onKeyDown={(e) => {
                    if (e.key === 'Enter' || e.key === ' ') {
                      e.preventDefault();
                      setMode('chronological');
                    }
                  }}
                  className={`p-3.5 rounded-xl border transition-all cursor-pointer ${
                    mode === 'chronological'
                      ? 'border-amber-500 bg-amber-500/10 ring-1 ring-amber-500/40'
                      : 'border-[#2e343b] hover:border-[#424953] bg-[#22262b]'
                  }`}
                >
                  <div className="flex items-center space-x-2 font-semibold text-sm text-white mb-1">
                    <Calendar className="w-4 h-4 text-emerald-400" />
                    <span>Chronological Air Date</span>
                  </div>
                  <p className="text-xs text-gray-400">
                    Interleaves episodes strictly by original release date. Great for shared TV universes or crossover events.
                  </p>
                </div>

                {/* Runtime-Balanced (Watch Time) */}
                <div
                  role="radio"
                  aria-checked={mode === 'runtime_balanced'}
                  tabIndex={0}
                  onClick={() => setMode('runtime_balanced')}
                  onKeyDown={(e) => {
                    if (e.key === 'Enter' || e.key === ' ') {
                      e.preventDefault();
                      setMode('runtime_balanced');
                    }
                  }}
                  className={`p-3.5 rounded-xl border transition-all cursor-pointer sm:col-span-2 ${
                    mode === 'runtime_balanced'
                      ? 'border-cyan-500 bg-cyan-500/10 ring-1 ring-cyan-500/40'
                      : 'border-[#2e343b] hover:border-[#424953] bg-[#22262b]'
                  }`}
                >
                  <div className="flex items-center space-x-2 font-semibold text-sm text-white mb-1">
                    <Clock className="w-4 h-4 text-cyan-400" />
                    <span>Runtime-Balanced (Smart Watch Time)</span>
                  </div>
                  <p className="text-xs text-gray-400">
                    Balances watch time using episode duration metadata from Plex while factoring in remaining episode counts. Shorter series are smoothly paced across the rotation so they don't run out prematurely.
                  </p>
                </div>
              </div>
            </div>

            {/* Playlist Settings (Buffer, Consecutive Episodes & Unwatched) */}
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-4 bg-[#16181b] p-4 rounded-xl border border-[#2d3238]">
              <div className="space-y-4">
                <div>
                  <label className="block text-xs font-semibold uppercase tracking-wider text-gray-400 mb-1.5">
                    Rolling Window Buffer Size
                  </label>
                  <div className="flex items-center space-x-2">
                    <input
                      type="number"
                      min="5"
                      max="500"
                      step="5"
                      value={bufferSize}
                      onChange={(e) => setBufferSize(Number(e.target.value))}
                      className="w-24 bg-[#22262b] border border-[#343b42] text-white rounded-lg px-3 py-2 text-sm focus:outline-none focus:border-amber-500"
                    />
                    <span className="text-xs text-gray-400">
                      episodes (0 = full queue)
                    </span>
                  </div>
                  <p className="text-[11px] text-gray-500 mt-1">
                    Keeping 25-50 episodes keeps Plex playback swift while auto-refilling as you watch.
                  </p>
                </div>

                <div>
                  <label className="block text-xs font-semibold uppercase tracking-wider text-gray-400 mb-1.5">
                    Episodes in a Row (Min / Max Range)
                  </label>
                  <div className="flex flex-wrap items-center gap-2">
                    <div className="flex items-center space-x-1.5 bg-[#22262b] border border-[#343b42] rounded-lg px-2.5 py-1">
                      <span className="text-xs text-gray-400 font-medium">Min:</span>
                      <input
                        type="number"
                        min="1"
                        max="10"
                        step="1"
                        value={minConsecutive}
                        onChange={(e) => {
                          const val = Math.max(1, Number(e.target.value) || 1);
                          setMinConsecutive(val);
                          if (maxConsecutive < val) setMaxConsecutive(val);
                        }}
                        className="w-12 bg-transparent text-white text-sm focus:outline-none"
                      />
                    </div>

                    <div className="flex items-center space-x-1.5 bg-[#22262b] border border-[#343b42] rounded-lg px-2.5 py-1">
                      <span className="text-xs text-gray-400 font-medium">Max:</span>
                      <input
                        type="number"
                        min={minConsecutive}
                        max="10"
                        step="1"
                        value={maxConsecutive}
                        onChange={(e) => {
                          const val = Math.max(minConsecutive, Number(e.target.value) || minConsecutive);
                          setMaxConsecutive(val);
                        }}
                        className="w-12 bg-transparent text-white text-sm focus:outline-none"
                      />
                    </div>

                    <span className="text-xs text-gray-400">
                      in a row (Default: 1–1)
                    </span>
                  </div>
                  <p className="text-[11px] text-gray-500 mt-1">
                    Set a range (e.g. 1 to 3) to let shorter or larger shows play up to 3 episodes in a block while longer or smaller shows play 1.
                  </p>
                </div>
              </div>

              <div className="space-y-3 pt-2">
                <label className="flex items-center space-x-3 cursor-pointer select-none">
                  <input
                    type="checkbox"
                    checked={unwatchedOnly}
                    onChange={(e) => setUnwatchedOnly(e.target.checked)}
                    className="w-4 h-4 text-amber-500 rounded bg-[#22262b] border-[#343b42] focus:ring-amber-500 focus:ring-offset-0"
                  />
                  <span className="text-sm font-medium text-gray-200">
                    Only include unwatched episodes
                  </span>
                </label>

                <label className="flex items-center space-x-3 cursor-pointer select-none">
                  <input
                    type="checkbox"
                    checked={includeSpecials}
                    onChange={(e) => setIncludeSpecials(e.target.checked)}
                    className="w-4 h-4 text-amber-500 rounded bg-[#22262b] border-[#343b42] focus:ring-amber-500 focus:ring-offset-0"
                  />
                  <span className="text-sm font-medium text-gray-200">
                    Include specials (Season 0)
                  </span>
                </label>

                <label className="flex items-center space-x-3 cursor-pointer select-none">
                  <input
                    type="checkbox"
                    checked={enabled}
                    onChange={(e) => setEnabled(e.target.checked)}
                    className="w-4 h-4 text-amber-500 rounded bg-[#22262b] border-[#343b42] focus:ring-amber-500 focus:ring-offset-0"
                  />
                  <span className="text-sm font-medium text-gray-200">
                    Enable automated background sync for this playlist
                  </span>
                </label>
              </div>
            </div>

            {/* Selected Shows Manager */}
            <div>
              <div className="flex items-center justify-between mb-3">
                <div>
                  <h3 className="text-sm font-bold text-white uppercase tracking-wider">
                    Shows in Rotation ({shows.length})
                  </h3>
                  <p className="text-xs text-gray-400">
                    Reorder shows, adjust weight multipliers, or reset watch status.
                  </p>
                </div>
                <button
                  type="button"
                  onClick={() => setShowPickerOpen(true)}
                  className="flex items-center space-x-1.5 bg-[#292f36] hover:bg-[#343b44] text-amber-400 border border-amber-500/30 text-xs font-semibold px-3 py-1.5 rounded-lg transition-colors cursor-pointer"
                >
                  <Plus className="w-3.5 h-3.5" />
                  <span>Add TV Shows</span>
                </button>
              </div>

              {shows.length === 0 ? (
                <div className="p-8 rounded-xl border border-dashed border-[#343b42] bg-[#16181b] text-center">
                  <p className="text-sm text-gray-400 mb-3">No shows have been added to this playlist yet.</p>
                  <button
                    type="button"
                    onClick={() => setShowPickerOpen(true)}
                    className="inline-flex items-center space-x-2 bg-amber-500 hover:bg-amber-400 text-black font-semibold text-xs px-4 py-2 rounded-lg transition-colors cursor-pointer"
                  >
                    <Plus className="w-4 h-4" />
                    <span>Select Shows from Plex</span>
                  </button>
                </div>
              ) : (
                <div className="space-y-2">
                  {shows.map((show, idx) => {
                    const posterUrl = getPosterUrl(show.thumb);
                    const isUnscrobbling = unscrobblingKey === show.ratingKey;
                    const isUnscrobbledSuccess = unscrobbledSuccessKey === show.ratingKey;

                    return (
                      <div
                        key={`${show.ratingKey}-${idx}`}
                        className="flex flex-col sm:flex-row sm:items-center justify-between gap-3 bg-[#1d2125] border border-[#2d3238] rounded-xl p-3"
                      >
                        {/* Show info */}
                        <div className="flex items-center space-x-3 min-w-0">
                          {posterUrl ? (
                            <img
                              src={posterUrl}
                              alt={show.title}
                              className="w-10 h-14 object-cover rounded bg-[#252a30] shrink-0"
                            />
                          ) : (
                            <div className="w-10 h-14 rounded bg-[#252a30] flex items-center justify-center shrink-0 text-xs text-gray-400 font-bold">
                              {show.title.slice(0, 2).toUpperCase()}
                            </div>
                          )}
                          <div className="min-w-0">
                            <p className="text-sm font-semibold text-white truncate">{show.title}</p>
                            <p className="text-xs text-gray-400">
                              {show.seasonCount ? `${show.seasonCount} ${show.seasonCount === 1 ? 'season' : 'seasons'} • ` : ''}
                              <span className="text-amber-400">
                                {show.unwatchedEpisodes !== undefined && show.unwatchedEpisodes !== null
                                  ? `${show.unwatchedEpisodes} unwatched`
                                  : show.totalEpisodes !== undefined && show.totalEpisodes !== null
                                  ? `${show.totalEpisodes} episodes`
                                  : 'Loading stats...'}
                              </span>
                            </p>
                          </div>
                        </div>

                        {/* Controls (Weight, Unscrobble, Reorder, Remove) */}
                        <div className="flex items-center justify-end space-x-2 shrink-0">
                          {/* Weight override input */}
                          <div className="flex items-center space-x-1.5 bg-[#252a30] px-2.5 py-1 rounded-lg border border-[#373e47]">
                            <span className="text-xs text-gray-400 font-medium">Weight:</span>
                            <input
                              type="number"
                              min="1"
                              max="20"
                              value={show.manualWeight || 1}
                              onChange={(e) => handleWeightChange(idx, Number(e.target.value))}
                              className="w-12 bg-[#1b1e22] text-amber-400 text-center font-bold text-xs rounded border border-[#444c56] py-0.5"
                              title="Relative weighting multiplier"
                            />
                            <span className="text-xs text-gray-400">x</span>
                          </div>

                          {/* Mark Unwatched button */}
                          <button
                            type="button"
                            onClick={() => handleMarkUnwatched(show.ratingKey)}
                            disabled={isUnscrobbling}
                            title="Mark this TV show as unwatched in Plex"
                            className={`p-2 rounded-lg text-xs font-medium border flex items-center gap-1 transition-colors cursor-pointer ${
                              isUnscrobbledSuccess
                                ? 'bg-emerald-500/20 text-emerald-300 border-emerald-500/30'
                                : 'bg-[#252a30] hover:bg-[#343b44] text-gray-300 hover:text-white border-[#373e47]'
                            }`}
                          >
                            <RotateCcw className={`w-3.5 h-3.5 ${isUnscrobbling ? 'animate-spin' : ''}`} />
                            <span className="hidden md:inline">
                              {isUnscrobbledSuccess ? 'Unwatched!' : 'Mark Unwatched'}
                            </span>
                          </button>

                          {/* Reorder Buttons */}
                          <div className="flex items-center bg-[#252a30] rounded-lg border border-[#373e47] overflow-hidden">
                            <button
                              type="button"
                              onClick={() => handleMoveShow(idx, 'up')}
                              disabled={idx === 0}
                              className="p-1.5 text-gray-400 hover:text-white hover:bg-[#343b44] disabled:opacity-30 cursor-pointer"
                            >
                              <ArrowUp className="w-3.5 h-3.5" />
                            </button>
                            <button
                              type="button"
                              onClick={() => handleMoveShow(idx, 'down')}
                              disabled={idx === shows.length - 1}
                              className="p-1.5 text-gray-400 hover:text-white hover:bg-[#343b44] disabled:opacity-30 cursor-pointer"
                            >
                              <ArrowDown className="w-3.5 h-3.5" />
                            </button>
                          </div>

                          {/* Delete from rotation */}
                          <button
                            type="button"
                            onClick={() => handleRemoveShow(idx)}
                            className="p-2 text-gray-400 hover:text-red-400 hover:bg-red-500/10 rounded-lg transition-colors cursor-pointer"
                          >
                            <Trash2 className="w-4 h-4" />
                          </button>
                        </div>
                      </div>
                    );
                  })}
                </div>
              )}
            </div>
          </div>

          {/* Footer Actions */}
          <div className="px-6 py-4 border-t border-[#2e343b] bg-[#16181b] flex flex-wrap items-center justify-between gap-3">
            <div>
              {playlist && (
                <button
                  type="button"
                  onClick={() => onPreview(playlist)}
                  className="flex items-center space-x-1.5 text-xs font-semibold text-gray-300 hover:text-white bg-[#252a30] hover:bg-[#313740] px-3.5 py-2 rounded-lg border border-[#3a414b] transition-colors cursor-pointer"
                >
                  <Eye className="w-4 h-4" />
                  <span>Preview Queue</span>
                </button>
              )}
            </div>

            <div className="flex items-center space-x-2">
              <button
                type="button"
                onClick={onClose}
                className="px-4 py-2 rounded-lg bg-[#272d33] hover:bg-[#343b44] text-sm text-gray-300 font-medium transition-colors cursor-pointer"
              >
                Cancel
              </button>
              <button
                type="button"
                onClick={() => handleSubmit(false)}
                disabled={isSaving}
                className="px-4 py-2 rounded-lg bg-[#313740] hover:bg-[#3d4550] text-sm font-semibold text-white transition-colors cursor-pointer"
              >
                Save Only
              </button>
              <button
                type="button"
                onClick={() => handleSubmit(true)}
                disabled={isSaving}
                className="px-5 py-2 rounded-lg bg-amber-500 hover:bg-amber-400 disabled:opacity-50 text-sm font-semibold text-black transition-colors shadow-md shadow-amber-500/10 cursor-pointer"
              >
                {isSaving ? 'Saving...' : 'Save & Sync Now'}
              </button>
            </div>
          </div>
        </div>
      </div>

      <ShowPickerModal
        isOpen={showPickerOpen}
        onClose={() => setShowPickerOpen(false)}
        alreadySelectedKeys={shows.map((s) => s.ratingKey)}
        onAddShows={handleAddShows}
      />
    </>
  );
};
