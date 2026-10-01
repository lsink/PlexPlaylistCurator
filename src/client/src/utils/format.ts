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
