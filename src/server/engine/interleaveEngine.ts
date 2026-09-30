export interface EpisodeItem {
  ratingKey: string;
  showRatingKey: string;
  showTitle: string;
  seasonNumber: number;
  episodeNumber: number;
  title: string;
  airDate?: string; // e.g. "2023-01-15"
  thumb?: string;
  duration?: number;
}

export interface ShowConfig {
  ratingKey: string;
  title: string;
  manualWeight?: number | null; // e.g. 2 for 2x frequency
  episodes: EpisodeItem[];
}

export type InterleaveMode = 'round_robin' | 'auto_proportional' | 'manual_weighted' | 'chronological' | 'runtime_balanced';

export interface InterleaveOptions {
  mode: InterleaveMode;
  bufferSize?: number; // max episodes to return, default infinite / all
}

/**
 * Interleave episodes according to the selected mode.
 * Always preserves strictly sequential order (S01E01 -> S01E02) within each show.
 */
export function interleaveEpisodes(
  shows: ShowConfig[],
  options: InterleaveOptions
): EpisodeItem[] {
  if (!shows || shows.length === 0) {
    return [];
  }

  // Filter shows with episodes and make copies of episode queues
  const activeShows = shows.filter((s) => s.episodes && s.episodes.length > 0);
  if (activeShows.length === 0) {
    return [];
  }

  const bufferSize = options.bufferSize && options.bufferSize > 0 ? options.bufferSize : Infinity;

  switch (options.mode) {
    case 'round_robin':
      return interleaveRoundRobin(activeShows, bufferSize);
    case 'auto_proportional':
      return interleaveAutoProportional(activeShows, bufferSize);
    case 'manual_weighted':
      return interleaveManualWeighted(activeShows, bufferSize);
    case 'chronological':
      return interleaveChronological(activeShows, bufferSize);
    case 'runtime_balanced':
      return interleaveRuntimeBalanced(activeShows, bufferSize);
    default:
      return interleaveRoundRobin(activeShows, bufferSize);
  }
}

/**
 * Strict 1:1:1 Round-Robin
 */
function interleaveRoundRobin(shows: ShowConfig[], bufferSize: number): EpisodeItem[] {
  const queues = shows.map((s) => [...s.episodes]);
  const result: EpisodeItem[] = [];

  let hasMore = true;
  while (hasMore && result.length < bufferSize) {
    hasMore = false;
    for (let i = 0; i < queues.length; i++) {
      if (queues[i].length > 0) {
        result.push(queues[i].shift()!);
        hasMore = true;
        if (result.length >= bufferSize) {
          break;
        }
      }
    }
  }

  return result;
}

/**
 * Auto-Proportional Pacing (Smooth Weighted Round-Robin):
 * Uses remaining episode count as weights so short shows don't burn out prematurely.
 */
function interleaveAutoProportional(shows: ShowConfig[], bufferSize: number): EpisodeItem[] {
  // Weights are initial episode counts (or minimum 1)
  const initialWeights = shows.map((s) => Math.max(1, s.episodes.length));
  return executeSWRR(shows, initialWeights, bufferSize);
}

/**
 * Manual Weighted Interleaving (Smooth Weighted Round-Robin):
 * Uses user-defined manual weights (defaulting to 1 if not specified).
 */
function interleaveManualWeighted(shows: ShowConfig[], bufferSize: number): EpisodeItem[] {
  const weights = shows.map((s) => {
    if (typeof s.manualWeight === 'number' && s.manualWeight > 0) {
      return Math.round(s.manualWeight);
    }
    return 1;
  });
  return executeSWRR(shows, weights, bufferSize);
}

/**
 * Smooth Weighted Round-Robin (SWRR) execution engine.
 * Distributes items smoothly across the timeline using accumulator credits.
 */
function executeSWRR(
  shows: ShowConfig[],
  weights: number[],
  bufferSize: number
): EpisodeItem[] {
  const queues = shows.map((s) => [...s.episodes]);
  const currentCredits = new Array(shows.length).fill(0);
  const result: EpisodeItem[] = [];

  while (result.length < bufferSize) {
    // 1. Identify indices that still have episodes
    const activeIndices: number[] = [];
    let totalActiveWeight = 0;

    for (let i = 0; i < queues.length; i++) {
      if (queues[i].length > 0) {
        activeIndices.push(i);
        totalActiveWeight += weights[i];
      }
    }

    if (activeIndices.length === 0 || totalActiveWeight === 0) {
      break; // All queues empty
    }

    // 2. Add weight to currentCredits for all active queues
    for (const idx of activeIndices) {
      currentCredits[idx] += weights[idx];
    }

    // 3. Find active show with max credit
    let bestIdx = activeIndices[0];
    let maxCredit = currentCredits[bestIdx];

    for (let k = 1; k < activeIndices.length; k++) {
      const idx = activeIndices[k];
      if (currentCredits[idx] > maxCredit) {
        maxCredit = currentCredits[idx];
        bestIdx = idx;
      }
    }

    // 4. Decrement best index by totalActiveWeight
    currentCredits[bestIdx] -= totalActiveWeight;

    // 5. Emit next episode
    const ep = queues[bestIdx].shift();
    if (ep) {
      result.push(ep);
    }
  }

  return result;
}

/**
 * Chronological ordering across all series by original air date.
 */
function interleaveChronological(shows: ShowConfig[], bufferSize: number): EpisodeItem[] {
  const allEpisodes: EpisodeItem[] = [];
  for (const show of shows) {
    allEpisodes.push(...show.episodes);
  }

  allEpisodes.sort((a, b) => {
    const dateA = a.airDate || '9999-99-99';
    const dateB = b.airDate || '9999-99-99';
    if (dateA !== dateB) {
      return dateA.localeCompare(dateB);
    }
    // Secondary sort: show name, then season, then episode
    if (a.showTitle !== b.showTitle) {
      return a.showTitle.localeCompare(b.showTitle);
    }
    if (a.seasonNumber !== b.seasonNumber) {
      return a.seasonNumber - b.seasonNumber;
    }
    return a.episodeNumber - b.episodeNumber;
  });

  return allEpisodes.slice(0, bufferSize);
}

/**
 * Runtime / Duration-Balanced Interleaving (Smooth Weighted Round-Robin):
 * Balances watch time across shows based on average episode length.
 * Shorter episodes (e.g. 22-min sitcoms) receive higher frequency weights than longer episodes (e.g. 50-min dramas),
 * resulting in equal viewing time per series.
 */
function interleaveRuntimeBalanced(shows: ShowConfig[], bufferSize: number): EpisodeItem[] {
  // Calculate average duration in minutes for each show
  const avgDurations = shows.map((s) => {
    const episodesWithDuration = s.episodes.filter(
      (e) => typeof e.duration === 'number' && e.duration > 0
    );
    if (episodesWithDuration.length === 0) {
      return 30; // default 30 mins
    }
    const totalMs = episodesWithDuration.reduce((acc, e) => acc + (e.duration || 0), 0);
    const avgMinutes = totalMs / episodesWithDuration.length / 60000;
    return Math.max(5, avgMinutes); // at least 5 mins
  });

  const maxAvgDuration = Math.max(...avgDurations);

  // Weights are inversely proportional to duration:
  // e.g. If max show is 50m and current show is 25m, weight is round(50/25) = 2
  const weights = avgDurations.map((dur) => Math.max(1, Math.round(maxAvgDuration / dur)));

  return executeSWRR(shows, weights, bufferSize);
}
