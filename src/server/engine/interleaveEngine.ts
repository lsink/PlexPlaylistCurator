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
  minConsecutive?: number; // min episodes in a row per show turn, default 1
  maxConsecutive?: number; // max episodes in a row per show turn, default 1
  consecutiveEpisodes?: number; // legacy alias if min/max not provided
}

/**
 * Scheduler position, saved between syncs so a rebuilt playlist continues the rotation instead of restarting it.
 * Keyed by show ratingKey so shows can be added, emptied or reordered without breaking it.
 */
export interface SchedulerState {
  /** Smooth weighted round-robin: accumulated credit per show */
  credits: Record<string, number>;
  /** Round-robin: the show whose turn is next */
  nextShow: string | null;
  /** A batch (consecutive episodes of one show) cut short by the buffer limit, finished first next time */
  carry: { show: string; remaining: number } | null;
}

export interface ScheduleResult {
  episodes: EpisodeItem[];
  state: SchedulerState;
}

const cloneState = (state: SchedulerState | null | undefined): SchedulerState => ({
  credits: { ...(state?.credits ?? {}) },
  nextShow: state?.nextShow ?? null,
  carry: state?.carry ? { ...state.carry } : null,
});

/**
 * Computes per-show batch sizes within [minConsecutive, maxConsecutive]
 * scaled proportionally to each show's relative weight / demand.
 */
function computeBatchSizes(
  metrics: number[],
  minConsecutive: number,
  maxConsecutive: number
): number[] {
  if (minConsecutive >= maxConsecutive) {
    return metrics.map(() => minConsecutive);
  }

  const minMetric = Math.min(...metrics);
  const maxMetric = Math.max(...metrics);
  const spread = maxMetric - minMetric;

  if (spread === 0) {
    return metrics.map(() => minConsecutive);
  }

  return metrics.map((val) => {
    const fraction = (val - minMetric) / spread;
    return Math.max(
      minConsecutive,
      Math.min(maxConsecutive, Math.round(minConsecutive + fraction * (maxConsecutive - minConsecutive)))
    );
  });
}

/**
 * Interleave episodes according to the selected mode.
 * Always preserves strictly sequential order (S01E01 -> S01E02) within each show.
 */
export function interleaveEpisodes(
  shows: ShowConfig[],
  options: InterleaveOptions
): EpisodeItem[] {
  return interleaveWithState(shows, options, null).episodes;
}

/**
 * Same as interleaveEpisodes, but starts from (and returns) a saved scheduler position.
 * With a null state the output is identical to interleaveEpisodes.
 */
export function interleaveWithState(
  shows: ShowConfig[],
  options: InterleaveOptions,
  state: SchedulerState | null
): ScheduleResult {
  const st = cloneState(state);
  if (!shows || shows.length === 0) {
    return { episodes: [], state: st };
  }

  // Filter shows with episodes and make copies of episode queues
  const activeShows = shows.filter((s) => s.episodes && s.episodes.length > 0);
  if (activeShows.length === 0) {
    return { episodes: [], state: st };
  }

  const bufferSize = options.bufferSize && options.bufferSize > 0 ? options.bufferSize : Infinity;
  const minConsecutive = Math.max(
    1,
    Math.round(options.minConsecutive || options.consecutiveEpisodes || 1)
  );
  const maxConsecutive = Math.max(
    minConsecutive,
    Math.round(options.maxConsecutive || minConsecutive)
  );

  switch (options.mode) {
    case 'auto_proportional':
      return interleaveAutoProportional(activeShows, bufferSize, minConsecutive, maxConsecutive, st);
    case 'manual_weighted':
      return interleaveManualWeighted(activeShows, bufferSize, minConsecutive, maxConsecutive, st);
    case 'chronological':
      return { episodes: interleaveChronological(activeShows, bufferSize), state: st };
    case 'runtime_balanced':
      return interleaveRuntimeBalanced(activeShows, bufferSize, minConsecutive, maxConsecutive, st);
    case 'round_robin':
    default:
      // All shows (not just active ones) so the saved "next show" can be found even if it has run dry
      return interleaveRoundRobin(shows, bufferSize, minConsecutive, st);
  }
}

/**
 * Continue a previously synced queue instead of rebuilding it from scratch.
 *
 * Rebuilding from scratch restarts the rotation every time, so after each watched episode the playlist would
 * begin with the same show again. Instead: keep the previous queue's order, drop the episodes that are no longer
 * eligible (watched, removed), and fill the end by continuing the rotation from the saved scheduler state.
 *
 * Falls back to a clean rebuild (continued: false) when there is nothing to continue, for chronological mode
 * (a global air-date order is already stable), or when a show's kept episodes are no longer the start of its
 * episode list (e.g. an earlier episode was marked unwatched, or a missing one was added to the library).
 */
export function continueSchedule(
  shows: ShowConfig[],
  options: InterleaveOptions,
  previous: { queue: string[]; state: SchedulerState } | null
): ScheduleResult & { continued: boolean } {
  const fresh = () => ({ ...interleaveWithState(shows, options, null), continued: false });
  if (!previous || options.mode === 'chronological') return fresh();

  const showIndexByEpisode = new Map<string, number>();
  const episodeByKey = new Map<string, EpisodeItem>();
  shows.forEach((show, i) =>
    show.episodes.forEach((ep) => {
      showIndexByEpisode.set(ep.ratingKey, i);
      episodeByKey.set(ep.ratingKey, ep);
    })
  );

  const kept = previous.queue.filter((key) => episodeByKey.has(key)).map((key) => episodeByKey.get(key)!);

  // Each show's kept episodes must be exactly the first N of its current list, in the same order
  const keptCounts = new Array(shows.length).fill(0);
  for (const ep of kept) {
    const i = showIndexByEpisode.get(ep.ratingKey)!;
    if (shows[i].episodes[keptCounts[i]]?.ratingKey !== ep.ratingKey) return fresh();
    keptCounts[i]++;
  }

  const bufferSize = options.bufferSize && options.bufferSize > 0 ? options.bufferSize : Infinity;
  if (kept.length >= bufferSize) {
    return { episodes: kept.slice(0, bufferSize), state: cloneState(previous.state), continued: true };
  }

  const rest = shows.map((show, i) => ({ ...show, episodes: show.episodes.slice(keptCounts[i]) }));
  const extension = interleaveWithState(rest, { ...options, bufferSize: bufferSize - kept.length }, previous.state);
  return { episodes: [...kept, ...extension.episodes], state: extension.state, continued: true };
}

/**
 * Strict 1:1:1 Round-Robin (or batch N:N:N if minConsecutive > 1)
 */
function interleaveRoundRobin(
  shows: ShowConfig[],
  bufferSize: number,
  consecutiveEpisodes: number,
  st: SchedulerState
): ScheduleResult {
  const queues = shows.map((s) => [...s.episodes]);
  const result: EpisodeItem[] = [];
  const n = shows.length;
  let carry: SchedulerState['carry'] = null;

  // Finish a batch that was cut short by the buffer last time
  if (st.carry) {
    const j = shows.findIndex((s) => s.ratingKey === st.carry!.show);
    if (j >= 0) {
      let emitted = 0;
      while (emitted < st.carry.remaining && queues[j].length > 0 && result.length < bufferSize) {
        result.push(queues[j].shift()!);
        emitted++;
      }
      if (emitted < st.carry.remaining && queues[j].length > 0) {
        carry = { show: st.carry.show, remaining: st.carry.remaining - emitted };
      }
    }
  }

  let idx = 0;
  if (st.nextShow) {
    const j = shows.findIndex((s) => s.ratingKey === st.nextShow);
    if (j >= 0) idx = j;
  }

  let emptyTurns = 0;
  while (result.length < bufferSize && emptyTurns < n) {
    const queue = queues[idx];
    if (queue.length === 0) {
      emptyTurns++;
      idx = (idx + 1) % n;
      continue;
    }
    emptyTurns = 0;
    let emitted = 0;
    while (emitted < consecutiveEpisodes && queue.length > 0 && result.length < bufferSize) {
      result.push(queue.shift()!);
      emitted++;
    }
    if (emitted < consecutiveEpisodes && queue.length > 0) {
      carry = { show: shows[idx].ratingKey, remaining: consecutiveEpisodes - emitted };
    }
    idx = (idx + 1) % n;
  }

  return { episodes: result, state: { ...st, nextShow: shows[idx].ratingKey, carry } };
}

/**
 * Auto-Proportional Pacing (Smooth Weighted Round-Robin):
 * Uses remaining episode count as weights so short shows don't burn out prematurely.
 */
function interleaveAutoProportional(
  shows: ShowConfig[],
  bufferSize: number,
  minConsecutive: number,
  maxConsecutive: number,
  st: SchedulerState
): ScheduleResult {
  // Weights are initial episode counts (or minimum 1)
  const initialWeights = shows.map((s) => Math.max(1, s.episodes.length));
  const batchSizes = computeBatchSizes(initialWeights, minConsecutive, maxConsecutive);
  const adjustedWeights = initialWeights.map((w, idx) =>
    Math.max(1, Math.round(w / (batchSizes[idx] || 1)))
  );
  return executeSWRR(shows, adjustedWeights, bufferSize, batchSizes, st);
}

/**
 * Manual Weighted Interleaving (Smooth Weighted Round-Robin):
 * Uses user-defined manual weights (defaulting to 1 if not specified).
 */
function interleaveManualWeighted(
  shows: ShowConfig[],
  bufferSize: number,
  minConsecutive: number,
  maxConsecutive: number,
  st: SchedulerState
): ScheduleResult {
  const weights = shows.map((s) => {
    if (typeof s.manualWeight === 'number' && s.manualWeight > 0) {
      return Math.round(s.manualWeight);
    }
    return 1;
  });
  const batchSizes = computeBatchSizes(weights, minConsecutive, maxConsecutive);
  const adjustedWeights = weights.map((w, idx) =>
    Math.max(1, Math.round(w / (batchSizes[idx] || 1)))
  );
  return executeSWRR(shows, adjustedWeights, bufferSize, batchSizes, st);
}

/**
 * Smooth Weighted Round-Robin (SWRR) execution engine.
 * Distributes items smoothly across the timeline using accumulator credits.
 */
function executeSWRR(
  shows: ShowConfig[],
  weights: number[],
  bufferSize: number,
  batchSizes: number[],
  st: SchedulerState
): ScheduleResult {
  const queues = shows.map((s) => [...s.episodes]);
  const currentCredits = shows.map((s) => st.credits[s.ratingKey] ?? 0);
  const result: EpisodeItem[] = [];
  let carry: SchedulerState['carry'] = null;

  // Finish a batch that was cut short by the buffer last time (its turn was already paid for)
  if (st.carry) {
    const j = shows.findIndex((s) => s.ratingKey === st.carry!.show);
    if (j >= 0) {
      let emitted = 0;
      while (emitted < st.carry.remaining && queues[j].length > 0 && result.length < bufferSize) {
        result.push(queues[j].shift()!);
        emitted++;
      }
      if (emitted < st.carry.remaining && queues[j].length > 0) {
        carry = { show: st.carry.show, remaining: st.carry.remaining - emitted };
      }
    }
  }

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

    // 5. Emit up to batchSizes[bestIdx] from bestIdx
    const countToEmit = batchSizes[bestIdx] || 1;
    let emitted = 0;
    for (let c = 0; c < countToEmit && queues[bestIdx].length > 0 && result.length < bufferSize; c++) {
      const ep = queues[bestIdx].shift();
      if (ep) {
        result.push(ep);
        emitted++;
      }
    }
    if (emitted < countToEmit && queues[bestIdx].length > 0) {
      carry = { show: shows[bestIdx].ratingKey, remaining: countToEmit - emitted };
    }
  }

  const credits = { ...st.credits };
  shows.forEach((s, i) => {
    credits[s.ratingKey] = currentCredits[i];
  });
  return { episodes: result, state: { ...st, credits, carry } };
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
    const dateA = a.airDate || '9999-12-31';
    const dateB = b.airDate || '9999-12-31';
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
 * Balances watch time across shows taking into account average episode length,
 * remaining episode count with sublinear square root dampening, AND user-defined
 * manual weight multipliers.
 *
 * Math model:
 * Weight_i = round(10 * sqrt(count_i / max_count) * (max_duration / duration_i) * manual_weight_i)
 *
 * Why square root dampening?
 * Prevents "starvation" of shorter series (e.g. 10 episodes alongside 200 episodes):
 * - Linear scaling would force the 10-episode show to wait 80+ episodes to appear.
 * - Square root dampening reduces the 20:1 gap to ~4.5:1, ensuring the smaller show
 *   appears immediately in the playlist buffer while still granting higher frequency
 *   to longer shows and shorter episode durations.
 */
function interleaveRuntimeBalanced(
  shows: ShowConfig[],
  bufferSize: number,
  minConsecutive: number,
  maxConsecutive: number,
  st: SchedulerState
): ScheduleResult {
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
  const episodeCounts = shows.map((s) => Math.max(1, s.episodes.length));
  const maxEpisodeCount = Math.max(...episodeCounts);

  // Sublinear square-root count weighting combined with duration factor and user manualWeight multiplier:
  const rawWeights = shows.map((s, idx) => {
    const count = episodeCounts[idx];
    const dur = avgDurations[idx];
    const userWeight = typeof s.manualWeight === 'number' && s.manualWeight > 0 ? s.manualWeight : 1;
    const countFactor = Math.sqrt(count / maxEpisodeCount);
    const durationFactor = maxAvgDuration / dur;
    return Math.max(1, Math.round(10 * countFactor * durationFactor * userWeight));
  });

  const batchSizes = computeBatchSizes(rawWeights, minConsecutive, maxConsecutive);

  // Adjust turn weights by batch size so that the batch size doesn't double-compound with turn frequency
  const adjustedWeights = rawWeights.map((w, idx) =>
    Math.max(1, Math.round(w / (batchSizes[idx] || 1)))
  );

  // Reduce by GCD to keep weights minimal
  const gcd = (a: number, b: number): number => (b === 0 ? a : gcd(b, a % b));
  const commonGcd = adjustedWeights.reduce((acc, w) => gcd(acc, w), adjustedWeights[0] || 1);
  const weights = adjustedWeights.map((w) => Math.max(1, Math.round(w / commonGcd)));

  return executeSWRR(shows, weights, bufferSize, batchSizes, st);
}
