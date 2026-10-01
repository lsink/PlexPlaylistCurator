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

export const formatDuration = (ms?: number): string => {
  if (!ms) return '';
  const minutes = Math.round(ms / 60000);
  return `${minutes} min`;
};
