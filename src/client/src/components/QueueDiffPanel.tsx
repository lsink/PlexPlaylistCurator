import React, { useState } from 'react';
import { GitCompare, ChevronDown, ChevronRight, ArrowUpRight, ArrowDownLeft } from 'lucide-react';
import { SyncDiff } from '../types';
import { parseDbTimestamp } from '../utils/format';

interface QueueDiffPanelProps {
  diff: SyncDiff;
}

const episodeCode = (season: number, episode: number) =>
  `S${String(season).padStart(2, '0')}E${String(episode).padStart(2, '0')}`;

export const QueueDiffPanel: React.FC<QueueDiffPanelProps> = ({ diff }) => {
  const [expanded, setExpanded] = useState(false);

  const lastSynced = diff.lastSyncedAt ? parseDbTimestamp(diff.lastSyncedAt).toLocaleString() : null;

  if (!diff.hasBaseline) {
    return (
      <div className="bg-[#16181b] border border-[#2d3238] rounded-xl p-4 flex items-start gap-3">
        <GitCompare className="w-4 h-4 text-gray-500 mt-0.5 shrink-0" />
        <p className="text-xs text-gray-400">
          Changes since the last sync will show up here. No previous sync has been recorded for comparison yet — sync once and this will start tracking.
        </p>
      </div>
    );
  }

  const removedByShow = new Map<string, number>();
  for (const ep of diff.removed) {
    removedByShow.set(ep.showTitle, (removedByShow.get(ep.showTitle) || 0) + 1);
  }

  const noChanges = diff.removed.length === 0 && diff.added.length === 0;

  return (
    <div className="bg-[#16181b] border border-[#2d3238] rounded-xl p-4 space-y-2.5">
      <div className="flex items-center justify-between gap-3">
        <h4 className="text-xs font-semibold uppercase tracking-wider text-gray-400 flex items-center gap-2">
          <GitCompare className="w-4 h-4 text-amber-500" />
          Changes since last sync
        </h4>
        {lastSynced && <span className="text-[11px] text-gray-500">{lastSynced}</span>}
      </div>

      {noChanges ? (
        <p className="text-xs text-gray-400">
          The queue is identical to what's currently in Plex ({diff.unchanged} episodes).
        </p>
      ) : (
        <>
          <div className="flex flex-wrap gap-x-5 gap-y-1.5 text-xs">
            <span className="flex items-center gap-1.5 text-emerald-400">
              <ArrowUpRight className="w-3.5 h-3.5" />
              <strong className="font-mono">{diff.added.length}</strong> new episode{diff.added.length !== 1 ? 's' : ''} enter the queue
            </span>
            <span className="flex items-center gap-1.5 text-amber-400">
              <ArrowDownLeft className="w-3.5 h-3.5" />
              <strong className="font-mono">{diff.removed.length}</strong> leave (watched or no longer available)
            </span>
            <span className="text-gray-500">{diff.unchanged} unchanged</span>
          </div>

          {diff.removed.length > 0 && (
            <>
              <p className="text-xs text-gray-400">
                {Array.from(removedByShow.entries())
                  .map(([title, count]) => `${title} ×${count}`)
                  .join(' · ')}
              </p>
              <button
                onClick={() => setExpanded((v) => !v)}
                aria-expanded={expanded}
                className="flex items-center gap-1 text-[11px] text-gray-400 hover:text-white cursor-pointer"
              >
                {expanded ? <ChevronDown className="w-3.5 h-3.5" /> : <ChevronRight className="w-3.5 h-3.5" />}
                {expanded ? 'Hide' : 'Show'} episodes leaving the queue
              </button>
              {expanded && (
                <ul className="max-h-40 overflow-y-auto space-y-1 text-xs text-gray-300 border-t border-[#2d3238] pt-2">
                  {diff.removed.map((ep) => (
                    <li key={ep.ratingKey} className="flex items-center gap-2">
                      <span className="font-semibold text-amber-400 truncate max-w-[40%]">{ep.showTitle}</span>
                      <span className="font-mono text-gray-400 bg-[#252a30] px-1.5 py-0.5 rounded">
                        {episodeCode(ep.seasonNumber, ep.episodeNumber)}
                      </span>
                      <span className="truncate text-gray-400">{ep.title}</span>
                    </li>
                  ))}
                </ul>
              )}
            </>
          )}
        </>
      )}
    </div>
  );
};
