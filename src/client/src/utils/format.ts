/**
 * SQLite's CURRENT_TIMESTAMP is UTC but has no timezone marker ("2026-10-01 00:22:37"), which browsers
 * would parse as local time. Mark it as UTC explicitly.
 */
export const parseDbTimestamp = (value: string): Date => {
  const hasZone = /[zZ]$|[+-]\d{2}:?\d{2}$/.test(value);
  return new Date(hasZone ? value : value.replace(' ', 'T') + 'Z');
};

/** Build a thumbnail URL through the backend Plex image proxy */
export const getPosterUrl = (thumb?: string | null): string | null => {
  if (!thumb) return null;
  return `/api/plex/image?path=${encodeURIComponent(thumb)}`;
};

/**
 * Estimated finish ('done' or YYYY-MM-DD) as short text: "Finished", "Done ~Oct 12" (within ~6 weeks),
 * otherwise "Done ~Mar 2027". Null when there is no estimate.
 */
export const formatFinish = (value?: string | null): string | null => {
  if (!value) return null;
  if (value === 'done') return 'Finished';
  const [y, m, d] = value.split('-').map(Number);
  if (!y || !m || !d) return null;
  const date = new Date(y, m - 1, d); // local date: no timezone shift
  const soon = date.getTime() - Date.now() < 45 * 24 * 60 * 60 * 1000;
  return `Done ~${date.toLocaleDateString(undefined, soon ? { month: 'short', day: 'numeric' } : { month: 'short', year: 'numeric' })}`;
};

/** Watching pace (episodes per day) as "~10 episodes/week" */
export const formatPace = (perDay: number): string => {
  const perWeek = perDay * 7;
  if (perWeek < 1) return 'less than 1 episode/week';
  const rounded = Math.round(perWeek);
  return `~${rounded} episode${rounded === 1 ? '' : 's'}/week`;
};

export const formatDuration = (ms?: number): string => {
  if (!ms) return '';
  const minutes = Math.round(ms / 60000);
  return `${minutes} min`;
};
