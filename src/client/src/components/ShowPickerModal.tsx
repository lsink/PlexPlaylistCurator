import React, { useState, useEffect } from 'react';
import { X, Search, Check, Tv, AlertCircle } from 'lucide-react';
import { ShowItem } from '../types';
import { api } from '../api/client';

interface ShowPickerModalProps {
  isOpen: boolean;
  onClose: () => void;
  alreadySelectedKeys: string[];
  onAddShows: (shows: ShowItem[]) => void;
  plexUrl?: string;
  plexToken?: string;
}

export const ShowPickerModal: React.FC<ShowPickerModalProps> = ({
  isOpen,
  onClose,
  alreadySelectedKeys,
  onAddShows,
  plexUrl,
  plexToken,
}) => {
  const [libraries, setLibraries] = useState<Array<{ key: string; title: string; type: string }>>([]);
  const [selectedLibraryKey, setSelectedLibraryKey] = useState<string>('');
  const [shows, setShows] = useState<ShowItem[]>([]);
  const [searchQuery, setSearchQuery] = useState('');
  const [selectedShows, setSelectedShows] = useState<Map<string, ShowItem>>(new Map());
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (isOpen) {
      loadLibraries();
      setSelectedShows(new Map());
      setSearchQuery('');
    }
  }, [isOpen]);

  const loadLibraries = async () => {
    try {
      setLoading(true);
      setError(null);
      const libs = await api.getLibraries();
      setLibraries(libs);
      if (libs.length > 0) {
        setSelectedLibraryKey(libs[0].key);
        loadShows(libs[0].key);
      } else {
        setShows([]);
      }
    } catch (err: any) {
      setError(err.message || 'Failed to load Plex TV libraries. Please check your Plex connection settings.');
    } finally {
      setLoading(false);
    }
  };

  const loadShows = async (sectionKey: string) => {
    try {
      setLoading(true);
      setError(null);
      const list = await api.getShows(sectionKey);
      setShows(list);
    } catch (err: any) {
      setError(err.message || 'Failed to fetch shows from Plex library.');
    } finally {
      setLoading(false);
    }
  };

  const handleLibraryChange = (key: string) => {
    setSelectedLibraryKey(key);
    loadShows(key);
  };

  const toggleSelectShow = (show: ShowItem) => {
    if (alreadySelectedKeys.includes(show.ratingKey)) {
      return; // Already added to playlist
    }

    const next = new Map(selectedShows);
    if (next.has(show.ratingKey)) {
      next.delete(show.ratingKey);
    } else {
      next.set(show.ratingKey, show);
    }
    setSelectedShows(next);
  };

  const handleConfirm = () => {
    onAddShows(Array.from(selectedShows.values()));
    onClose();
  };

  const filteredShows = shows.filter((s) =>
    s.title.toLowerCase().includes(searchQuery.toLowerCase())
  );

  const getPosterUrl = (thumb?: string | null) => {
    if (!thumb || !plexUrl) return null;
    return `${plexUrl}${thumb}?X-Plex-Token=${plexToken}`;
  };

  if (!isOpen) return null;

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/75 backdrop-blur-sm animate-fade-in">
      <div className="bg-[#1b1e22] border border-[#2e343b] rounded-2xl w-full max-w-4xl max-h-[85vh] flex flex-col shadow-2xl overflow-hidden">
        {/* Header */}
        <div className="px-6 py-4 border-b border-[#2e343b] flex items-center justify-between">
          <div className="flex items-center space-x-2">
            <Tv className="w-5 h-5 text-amber-500" />
            <h2 className="text-lg font-bold text-white">Select TV Shows from Plex</h2>
          </div>
          <button
            onClick={onClose}
            className="p-1 rounded-lg text-gray-400 hover:text-white hover:bg-[#282d33] transition-colors cursor-pointer"
          >
            <X className="w-5 h-5" />
          </button>
        </div>

        {/* Filters bar */}
        <div className="p-4 border-b border-[#2e343b] bg-[#16181b] flex flex-col sm:flex-row gap-3 items-center justify-between">
          <div className="w-full sm:w-64">
            <label className="block text-[11px] font-medium text-gray-400 uppercase tracking-wider mb-1">
              Plex Library
            </label>
            <select
              value={selectedLibraryKey}
              onChange={(e) => handleLibraryChange(e.target.value)}
              className="w-full bg-[#22262b] border border-[#343b42] text-white rounded-lg px-3 py-2 text-sm focus:outline-none focus:border-amber-500"
            >
              {libraries.map((lib) => (
                <option key={lib.key} value={lib.key}>
                  {lib.title}
                </option>
              ))}
            </select>
          </div>

          <div className="w-full sm:flex-1 relative">
            <label className="block text-[11px] font-medium text-gray-400 uppercase tracking-wider mb-1">
              Search Shows
            </label>
            <div className="relative">
              <Search className="w-4 h-4 text-gray-400 absolute left-3 top-2.5" />
              <input
                type="text"
                value={searchQuery}
                onChange={(e) => setSearchQuery(e.target.value)}
                placeholder="Search TV shows..."
                className="w-full bg-[#22262b] border border-[#343b42] text-white rounded-lg pl-9 pr-3 py-2 text-sm focus:outline-none focus:border-amber-500 placeholder-gray-500"
              />
            </div>
          </div>
        </div>

        {/* Show Grid */}
        <div className="flex-1 overflow-y-auto p-4 sm:p-6">
          {error && (
            <div className="mb-4 p-4 rounded-xl bg-red-500/10 border border-red-500/30 flex items-center gap-3 text-red-400 text-sm">
              <AlertCircle className="w-5 h-5 shrink-0" />
              <span>{error}</span>
            </div>
          )}

          {loading ? (
            <div className="h-64 flex flex-col items-center justify-center space-y-3 text-gray-400">
              <div className="w-8 h-8 border-2 border-amber-500 border-t-transparent rounded-full animate-spin"></div>
              <p className="text-sm">Loading shows from Plex...</p>
            </div>
          ) : filteredShows.length === 0 ? (
            <div className="h-64 flex flex-col items-center justify-center text-gray-500">
              <Tv className="w-12 h-12 mb-2 opacity-30" />
              <p className="text-sm">No shows found in this library.</p>
            </div>
          ) : (
            <div className="grid grid-cols-2 sm:grid-cols-3 md:grid-cols-4 lg:grid-cols-5 gap-3 sm:gap-4">
              {filteredShows.map((show) => {
                const isAlreadyIn = alreadySelectedKeys.includes(show.ratingKey);
                const isSelected = selectedShows.has(show.ratingKey);
                const posterUrl = getPosterUrl(show.thumb);

                return (
                  <div
                    key={show.ratingKey}
                    onClick={() => toggleSelectShow(show)}
                    className={`relative rounded-xl border overflow-hidden transition-all text-left flex flex-col justify-between ${
                      isAlreadyIn
                        ? 'opacity-40 border-gray-700 bg-[#16181b] cursor-not-allowed'
                        : isSelected
                        ? 'border-amber-500 ring-2 ring-amber-500/50 bg-[#252b32] cursor-pointer scale-[1.02]'
                        : 'border-[#2d333a] hover:border-[#444c56] bg-[#1d2125] cursor-pointer hover:scale-[1.01]'
                    }`}
                  >
                    {/* Poster */}
                    <div className="aspect-[2/3] bg-[#22272d] relative overflow-hidden">
                      {posterUrl ? (
                        <img
                          src={posterUrl}
                          alt={show.title}
                          className="w-full h-full object-cover"
                          onError={(e) => {
                            (e.target as HTMLElement).style.display = 'none';
                          }}
                        />
                      ) : (
                        <div className="w-full h-full flex items-center justify-center text-xs text-gray-500 font-bold p-2 text-center">
                          {show.title}
                        </div>
                      )}

                      {/* Selection overlay indicator */}
                      {isSelected && (
                        <div className="absolute top-2 right-2 w-6 h-6 rounded-full bg-amber-500 text-black flex items-center justify-center shadow-lg">
                          <Check className="w-4 h-4 stroke-[3]" />
                        </div>
                      )}

                      {isAlreadyIn && (
                        <div className="absolute inset-0 bg-black/60 flex items-center justify-center p-2 text-center">
                          <span className="text-[11px] font-semibold text-gray-300 bg-black/80 px-2 py-1 rounded">
                            Already In Playlist
                          </span>
                        </div>
                      )}
                    </div>

                    {/* Metadata */}
                    <div className="p-2.5">
                      <p className="text-xs font-semibold text-white truncate" title={show.title}>
                        {show.title}
                      </p>
                      <div className="flex items-center justify-between text-[10px] text-gray-400 mt-1">
                        <span>{show.seasonCount || 1} seasons</span>
                        <span className="text-amber-400 font-medium">
                          {show.unwatchedEpisodes ?? show.totalEpisodes} unwatched
                        </span>
                      </div>
                    </div>
                  </div>
                );
              })}
            </div>
          )}
        </div>

        {/* Footer */}
        <div className="px-6 py-4 border-t border-[#2e343b] bg-[#16181b] flex items-center justify-between">
          <span className="text-xs text-gray-400">
            {selectedShows.size} show{selectedShows.size !== 1 ? 's' : ''} selected
          </span>
          <div className="flex items-center space-x-2">
            <button
              onClick={onClose}
              className="px-4 py-2 rounded-lg bg-[#272d33] hover:bg-[#343b44] text-sm text-gray-300 font-medium transition-colors cursor-pointer"
            >
              Cancel
            </button>
            <button
              onClick={handleConfirm}
              disabled={selectedShows.size === 0}
              className="px-5 py-2 rounded-lg bg-amber-500 hover:bg-amber-400 disabled:opacity-40 text-sm font-semibold text-black transition-colors cursor-pointer"
            >
              Add {selectedShows.size > 0 ? `(${selectedShows.size})` : ''}
            </button>
          </div>
        </div>
      </div>
    </div>
  );
};
