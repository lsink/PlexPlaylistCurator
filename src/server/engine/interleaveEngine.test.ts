import { describe, it, expect } from 'vitest';
import {
  interleaveEpisodes,
  continueSchedule,
  ShowConfig,
  EpisodeItem,
  InterleaveOptions,
  SchedulerState,
} from './interleaveEngine.js';

function makeMockEpisodes(
  showRatingKey: string,
  showTitle: string,
  count: number,
  startSeason = 1
): EpisodeItem[] {
  const eps: EpisodeItem[] = [];
  for (let i = 1; i <= count; i++) {
    eps.push({
      ratingKey: `${showRatingKey}-s${startSeason}e${i}`,
      showRatingKey,
      showTitle,
      seasonNumber: startSeason,
      episodeNumber: i,
      title: `${showTitle} Episode ${i}`,
      airDate: `2020-01-${String(i).padStart(2, '0')}`,
    });
  }
  return eps;
}

describe('interleaveEngine', () => {
  it('should handle empty input', () => {
    expect(interleaveEpisodes([], { mode: 'round_robin' })).toEqual([]);
    expect(
      interleaveEpisodes([{ ratingKey: '1', title: 'A', episodes: [] }], {
        mode: 'round_robin',
      })
    ).toEqual([]);
  });

  it('performs pure round-robin correctly', () => {
    const showA: ShowConfig = {
      ratingKey: 'A',
      title: 'Show A',
      episodes: makeMockEpisodes('A', 'Show A', 3),
    };
    const showB: ShowConfig = {
      ratingKey: 'B',
      title: 'Show B',
      episodes: makeMockEpisodes('B', 'Show B', 2),
    };

    const result = interleaveEpisodes([showA, showB], { mode: 'round_robin' });
    expect(result.map((r) => `${r.showTitle} E${r.episodeNumber}`)).toEqual([
      'Show A E1',
      'Show B E1',
      'Show A E2',
      'Show B E2',
      'Show A E3',
    ]);
  });

  it('respects buffer size limit', () => {
    const showA: ShowConfig = {
      ratingKey: 'A',
      title: 'Show A',
      episodes: makeMockEpisodes('A', 'Show A', 5),
    };
    const showB: ShowConfig = {
      ratingKey: 'B',
      title: 'Show B',
      episodes: makeMockEpisodes('B', 'Show B', 5),
    };

    const result = interleaveEpisodes([showA, showB], {
      mode: 'round_robin',
      bufferSize: 3,
    });
    expect(result.length).toBe(3);
    expect(result.map((r) => r.showTitle)).toEqual(['Show A', 'Show B', 'Show A']);
  });

  it('handles auto-proportional pacing (Smooth Weighted Round-Robin)', () => {
    // Show A has 4 episodes, Show B has 2 episodes.
    // Ratio is 2:1. Show B should not run out in the first 2 episodes.
    const showA: ShowConfig = {
      ratingKey: 'A',
      title: 'Show A',
      episodes: makeMockEpisodes('A', 'Show A', 4),
    };
    const showB: ShowConfig = {
      ratingKey: 'B',
      title: 'Show B',
      episodes: makeMockEpisodes('B', 'Show B', 2),
    };

    const result = interleaveEpisodes([showA, showB], {
      mode: 'auto_proportional',
    });
    expect(result.length).toBe(6);

    const showTitles = result.map((r) => r.showTitle);
    // Show B should be spaced out rather than clustered at the start
    // Expected SWRR distribution: A, B, A, A, B, A
    expect(showTitles).toEqual(['Show A', 'Show B', 'Show A', 'Show A', 'Show B', 'Show A']);

    // Check that sequential order is strictly maintained
    const aEps = result.filter((r) => r.showTitle === 'Show A').map((r) => r.episodeNumber);
    const bEps = result.filter((r) => r.showTitle === 'Show B').map((r) => r.episodeNumber);
    expect(aEps).toEqual([1, 2, 3, 4]);
    expect(bEps).toEqual([1, 2]);
  });

  it('handles manual weighted override', () => {
    // Show A manual weight 3, Show B manual weight 1
    const showA: ShowConfig = {
      ratingKey: 'A',
      title: 'Show A',
      manualWeight: 3,
      episodes: makeMockEpisodes('A', 'Show A', 6),
    };
    const showB: ShowConfig = {
      ratingKey: 'B',
      title: 'Show B',
      manualWeight: 1,
      episodes: makeMockEpisodes('B', 'Show B', 2),
    };

    const result = interleaveEpisodes([showA, showB], {
      mode: 'manual_weighted',
    });
    expect(result.length).toBe(8);

    // Verify sequential progression
    const aEps = result.filter((r) => r.showTitle === 'Show A').map((r) => r.episodeNumber);
    const bEps = result.filter((r) => r.showTitle === 'Show B').map((r) => r.episodeNumber);
    expect(aEps).toEqual([1, 2, 3, 4, 5, 6]);
    expect(bEps).toEqual([1, 2]);
  });

  it('handles chronological ordering by air date', () => {
    const showA: ShowConfig = {
      ratingKey: 'A',
      title: 'Show A',
      episodes: [
        {
          ratingKey: 'A1',
          showRatingKey: 'A',
          showTitle: 'Show A',
          seasonNumber: 1,
          episodeNumber: 1,
          title: 'A1',
          airDate: '2020-01-01',
        },
        {
          ratingKey: 'A2',
          showRatingKey: 'A',
          showTitle: 'Show A',
          seasonNumber: 1,
          episodeNumber: 2,
          title: 'A2',
          airDate: '2020-01-15',
        },
      ],
    };
    const showB: ShowConfig = {
      ratingKey: 'B',
      title: 'Show B',
      episodes: [
        {
          ratingKey: 'B1',
          showRatingKey: 'B',
          showTitle: 'Show B',
          seasonNumber: 1,
          episodeNumber: 1,
          title: 'B1',
          airDate: '2020-01-08',
        },
        {
          ratingKey: 'B2',
          showRatingKey: 'B',
          showTitle: 'Show B',
          seasonNumber: 1,
          episodeNumber: 2,
          title: 'B2',
          airDate: '2020-01-22',
        },
      ],
    };

    const result = interleaveEpisodes([showA, showB], {
      mode: 'chronological',
    });
    expect(result.map((r) => r.title)).toEqual(['A1', 'B1', 'A2', 'B2']);
  });

  it('handles runtime_balanced mode based on episode duration when counts are equal', () => {
    // Both shows have 6 episodes.
    // Show A has 20-minute episodes (1,200,000 ms)
    // Show B has 60-minute episodes (3,600,000 ms)
    // Pacing ratio is 3:1 (3 episodes of Show A per 1 episode of Show B)
    const showA: ShowConfig = {
      ratingKey: 'A',
      title: 'Comedy (20m)',
      episodes: [
        { ratingKey: 'A1', showRatingKey: 'A', showTitle: 'Comedy (20m)', seasonNumber: 1, episodeNumber: 1, title: 'C1', duration: 1200000 },
        { ratingKey: 'A2', showRatingKey: 'A', showTitle: 'Comedy (20m)', seasonNumber: 1, episodeNumber: 2, title: 'C2', duration: 1200000 },
        { ratingKey: 'A3', showRatingKey: 'A', showTitle: 'Comedy (20m)', seasonNumber: 1, episodeNumber: 3, title: 'C3', duration: 1200000 },
        { ratingKey: 'A4', showRatingKey: 'A', showTitle: 'Comedy (20m)', seasonNumber: 1, episodeNumber: 4, title: 'C4', duration: 1200000 },
        { ratingKey: 'A5', showRatingKey: 'A', showTitle: 'Comedy (20m)', seasonNumber: 1, episodeNumber: 5, title: 'C5', duration: 1200000 },
        { ratingKey: 'A6', showRatingKey: 'A', showTitle: 'Comedy (20m)', seasonNumber: 1, episodeNumber: 6, title: 'C6', duration: 1200000 },
      ],
    };

    const showB: ShowConfig = {
      ratingKey: 'B',
      title: 'Drama (60m)',
      episodes: [
        { ratingKey: 'B1', showRatingKey: 'B', showTitle: 'Drama (60m)', seasonNumber: 1, episodeNumber: 1, title: 'D1', duration: 3600000 },
        { ratingKey: 'B2', showRatingKey: 'B', showTitle: 'Drama (60m)', seasonNumber: 1, episodeNumber: 2, title: 'D2', duration: 3600000 },
        { ratingKey: 'B3', showRatingKey: 'B', showTitle: 'Drama (60m)', seasonNumber: 1, episodeNumber: 3, title: 'D3', duration: 3600000 },
        { ratingKey: 'B4', showRatingKey: 'B', showTitle: 'Drama (60m)', seasonNumber: 1, episodeNumber: 4, title: 'D4', duration: 3600000 },
        { ratingKey: 'B5', showRatingKey: 'B', showTitle: 'Drama (60m)', seasonNumber: 1, episodeNumber: 5, title: 'D5', duration: 3600000 },
        { ratingKey: 'B6', showRatingKey: 'B', showTitle: 'Drama (60m)', seasonNumber: 1, episodeNumber: 6, title: 'D6', duration: 3600000 },
      ],
    };

    const result = interleaveEpisodes([showA, showB], {
      mode: 'runtime_balanced',
      bufferSize: 8,
    });

    expect(result.length).toBe(8);
    // Verified 3:1 smooth distribution pattern: C1, C2, D1, C3, C4, C5, D2, C6
    const titles = result.map((r) => r.title);
    expect(titles).toEqual(['C1', 'C2', 'D1', 'C3', 'C4', 'C5', 'D2', 'C6']);
    expect(result.filter((r) => r.showRatingKey === 'A').length).toBe(6);
    expect(result.filter((r) => r.showRatingKey === 'B').length).toBe(2);
    // Sequential order maintained
    expect(result.filter((r) => r.showRatingKey === 'A').map((r) => r.episodeNumber)).toEqual([1, 2, 3, 4, 5, 6]);
    expect(result.filter((r) => r.showRatingKey === 'B').map((r) => r.episodeNumber)).toEqual([1, 2]);
  });

  it('protects short-running shows from premature burnout by factoring in episode counts', () => {
    // Show A is short (only 2 episodes, 20m each)
    // Show B is longer (6 episodes, 60m each)
    // Under pure duration, Show A would get weight 3 and burn out immediately in the first 2 slots.
    // Under hybrid duration + count balancing:
    // W_A = 2 * (60/20) = 6
    // W_B = 6 * (60/60) = 6
    // Effective weights are 1:1, spacing Show A smoothly across Show B!
    const showA: ShowConfig = {
      ratingKey: 'A',
      title: 'Short Sitcom (20m)',
      episodes: [
        { ratingKey: 'A1', showRatingKey: 'A', showTitle: 'Short Sitcom', seasonNumber: 1, episodeNumber: 1, title: 'S1', duration: 1200000 },
        { ratingKey: 'A2', showRatingKey: 'A', showTitle: 'Short Sitcom', seasonNumber: 1, episodeNumber: 2, title: 'S2', duration: 1200000 },
      ],
    };

    const showB: ShowConfig = {
      ratingKey: 'B',
      title: 'Long Drama (60m)',
      episodes: [
        { ratingKey: 'B1', showRatingKey: 'B', showTitle: 'Long Drama', seasonNumber: 1, episodeNumber: 1, title: 'D1', duration: 3600000 },
        { ratingKey: 'B2', showRatingKey: 'B', showTitle: 'Long Drama', seasonNumber: 1, episodeNumber: 2, title: 'D2', duration: 3600000 },
        { ratingKey: 'B3', showRatingKey: 'B', showTitle: 'Long Drama', seasonNumber: 1, episodeNumber: 3, title: 'D3', duration: 3600000 },
        { ratingKey: 'B4', showRatingKey: 'B', showTitle: 'Long Drama', seasonNumber: 1, episodeNumber: 4, title: 'D4', duration: 3600000 },
        { ratingKey: 'B5', showRatingKey: 'B', showTitle: 'Long Drama', seasonNumber: 1, episodeNumber: 5, title: 'D5', duration: 3600000 },
        { ratingKey: 'B6', showRatingKey: 'B', showTitle: 'Long Drama', seasonNumber: 1, episodeNumber: 6, title: 'D6', duration: 3600000 },
      ],
    };

    const result = interleaveEpisodes([showA, showB], {
      mode: 'runtime_balanced',
    });

    expect(result.length).toBe(8);
    // Smooth 1:1 interleaved distribution until Show A exhausts, followed by remaining Show B episodes
    const titles = result.map((r) => r.title);
    expect(titles).toEqual(['S1', 'D1', 'S2', 'D2', 'D3', 'D4', 'D5', 'D6']);
  });

  it('prevents starvation when mixing a 10-episode miniseries with four 200-episode shows', () => {
    // 4 shows with 200 episodes (60m each)
    // 1 show with 10 episodes (60m each)
    const shows: ShowConfig[] = [
      { ratingKey: 'S1', title: 'Show 1', episodes: makeMockEpisodes('S1', 'Show 1', 200) },
      { ratingKey: 'S2', title: 'Show 2', episodes: makeMockEpisodes('S2', 'Show 2', 200) },
      { ratingKey: 'S3', title: 'Show 3', episodes: makeMockEpisodes('S3', 'Show 3', 200) },
      { ratingKey: 'S4', title: 'Show 4', episodes: makeMockEpisodes('S4', 'Show 4', 200) },
      { ratingKey: 'Mini', title: 'Miniseries', episodes: makeMockEpisodes('Mini', 'Miniseries', 10) },
    ];

    // Request a 50-episode rolling window buffer
    const result = interleaveEpisodes(shows, {
      mode: 'runtime_balanced',
      bufferSize: 50,
    });

    expect(result.length).toBe(50);
    // Under linear weighting, the miniseries would have weight 1 vs 20 for the others (80 episodes of others before Mini).
    // Under square-root dampening, the miniseries appears early (within the first ~25 episodes)!
    const firstMiniIndex = result.findIndex((ep) => ep.showRatingKey === 'Mini');
    expect(firstMiniIndex).toBeGreaterThan(-1);
    expect(firstMiniIndex).toBeLessThan(25);

    // Verify it appears multiple times in the first 50 items
    const miniCount = result.filter((ep) => ep.showRatingKey === 'Mini').length;
    expect(miniCount).toBeGreaterThanOrEqual(2);
  });

  it('supports consecutiveEpisodes in round-robin mode (e.g. 2 episodes in a row)', () => {
    const showA: ShowConfig = {
      ratingKey: 'A',
      title: 'Show A',
      episodes: makeMockEpisodes('A', 'Show A', 3),
    };
    const showB: ShowConfig = {
      ratingKey: 'B',
      title: 'Show B',
      episodes: makeMockEpisodes('B', 'Show B', 3),
    };

    const result = interleaveEpisodes([showA, showB], {
      mode: 'round_robin',
      consecutiveEpisodes: 2,
    });

    expect(result.map((r) => `${r.showTitle} E${r.episodeNumber}`)).toEqual([
      'Show A E1',
      'Show A E2',
      'Show B E1',
      'Show B E2',
      'Show A E3',
      'Show B E3',
    ]);
  });

  it('supports consecutiveEpisodes in runtime_balanced mode', () => {
    const showA: ShowConfig = {
      ratingKey: 'A',
      title: 'Show A',
      episodes: makeMockEpisodes('A', 'Show A', 4),
    };
    const showB: ShowConfig = {
      ratingKey: 'B',
      title: 'Show B',
      episodes: makeMockEpisodes('B', 'Show B', 4),
    };

    const result = interleaveEpisodes([showA, showB], {
      mode: 'runtime_balanced',
      consecutiveEpisodes: 2,
    });

    expect(result.map((r) => `${r.showTitle} E${r.episodeNumber}`)).toEqual([
      'Show A E1',
      'Show A E2',
      'Show B E1',
      'Show B E2',
      'Show A E3',
      'Show A E4',
      'Show B E3',
      'Show B E4',
    ]);
  });

  it('supports dynamic batching with minConsecutive and maxConsecutive in runtime_balanced mode', () => {
    // Show A is a 20-minute comedy (1,200,000 ms)
    // Show B is a 60-minute drama (3,600,000 ms)
    // With minConsecutive = 1 and maxConsecutive = 3:
    // Show A (shorter) gets batch size 3 (3 x 20m = 60m block)
    // Show B (longer) gets batch size 1 (1 x 60m = 60m block)
    const showA: ShowConfig = {
      ratingKey: 'A',
      title: 'Comedy (20m)',
      episodes: [
        { ratingKey: 'A1', showRatingKey: 'A', showTitle: 'Comedy', seasonNumber: 1, episodeNumber: 1, title: 'C1', duration: 1200000 },
        { ratingKey: 'A2', showRatingKey: 'A', showTitle: 'Comedy', seasonNumber: 1, episodeNumber: 2, title: 'C2', duration: 1200000 },
        { ratingKey: 'A3', showRatingKey: 'A', showTitle: 'Comedy', seasonNumber: 1, episodeNumber: 3, title: 'C3', duration: 1200000 },
        { ratingKey: 'A4', showRatingKey: 'A', showTitle: 'Comedy', seasonNumber: 1, episodeNumber: 4, title: 'C4', duration: 1200000 },
        { ratingKey: 'A5', showRatingKey: 'A', showTitle: 'Comedy', seasonNumber: 1, episodeNumber: 5, title: 'C5', duration: 1200000 },
        { ratingKey: 'A6', showRatingKey: 'A', showTitle: 'Comedy', seasonNumber: 1, episodeNumber: 6, title: 'C6', duration: 1200000 },
      ],
    };

    const showB: ShowConfig = {
      ratingKey: 'B',
      title: 'Drama (60m)',
      episodes: [
        { ratingKey: 'B1', showRatingKey: 'B', showTitle: 'Drama', seasonNumber: 1, episodeNumber: 1, title: 'D1', duration: 3600000 },
        { ratingKey: 'B2', showRatingKey: 'B', showTitle: 'Drama', seasonNumber: 1, episodeNumber: 2, title: 'D2', duration: 3600000 },
      ],
    };

    const result = interleaveEpisodes([showA, showB], {
      mode: 'runtime_balanced',
      minConsecutive: 1,
      maxConsecutive: 3,
    });

    expect(result.length).toBe(8);
    // Verified 3-in-a-row for comedy (60m) followed by 1 drama (60m):
    expect(result.map((r) => r.title)).toEqual([
      'C1', 'C2', 'C3',
      'D1',
      'C4', 'C5', 'C6',
      'D2',
    ]);
  });

  it('incorporates manualWeight multiplier in runtime_balanced mode', () => {
    // Both shows have equal episodes (6) and equal episode length (60m)
    // Show A has manualWeight 1
    // Show B has manualWeight 2
    // With 1x vs 2x multiplier, Show B should be scheduled twice as frequently as Show A
    const showA: ShowConfig = {
      ratingKey: 'A',
      title: 'Show A (1x)',
      manualWeight: 1,
      episodes: makeMockEpisodes('A', 'Show A', 6),
    };
    // add durations
    showA.episodes.forEach((e) => (e.duration = 3600000));

    const showB: ShowConfig = {
      ratingKey: 'B',
      title: 'Show B (2x)',
      manualWeight: 2,
      episodes: makeMockEpisodes('B', 'Show B', 6),
    };
    showB.episodes.forEach((e) => (e.duration = 3600000));

    const result = interleaveEpisodes([showA, showB], {
      mode: 'runtime_balanced',
      bufferSize: 6,
    });

    expect(result.length).toBe(6);
    // SWRR with weights 1:2 -> B, A, B, B, A, B
    expect(result.map((r) => r.showTitle)).toEqual([
      'Show B',
      'Show A',
      'Show B',
      'Show B',
      'Show A',
      'Show B',
    ]);
  });
});

describe('continueSchedule (rotation survives playlist rebuilds)', () => {
  // Shows built from a "watched so far" count, the way the sync service sees them (unwatched episodes only)
  const showsAfter = (spec: Record<string, number>, watched: Record<string, number>, minutes: Record<string, number> = {}): ShowConfig[] =>
    Object.entries(spec).map(([key, total]) => ({
      ratingKey: key,
      title: key,
      manualWeight: key === 'A' ? 3 : 1,
      episodes: Array.from({ length: total - (watched[key] || 0) }, (_, i) => {
        const n = (watched[key] || 0) + i + 1;
        return {
          ratingKey: `${key}-${n}`,
          showRatingKey: key,
          showTitle: key,
          seasonNumber: 1,
          episodeNumber: n,
          title: `${key} ${n}`,
          duration: (minutes[key] ?? 22) * 60000,
        };
      }),
    }));

  // Repeatedly watch the first episode of the playlist and rebuild it, like the webhook does
  function watchAndRebuild(spec: Record<string, number>, options: InterleaveOptions, episodesToWatch: number, minutes?: Record<string, number>) {
    const watched: Record<string, number> = {};
    let previous: { queue: string[]; state: SchedulerState; positions: (SchedulerState | null)[] } | null = null;
    const order: string[] = [];
    let firstQueue: string[] = [];
    for (let i = 0; i < episodesToWatch; i++) {
      const result = continueSchedule(showsAfter(spec, watched, minutes), options, previous);
      if (i === 0) firstQueue = result.episodes.map((e) => e.showRatingKey);
      const next = result.episodes[0];
      if (!next) break;
      order.push(next.showRatingKey);
      watched[next.showRatingKey] = (watched[next.showRatingKey] || 0) + 1;
      previous = { queue: result.episodes.map((e) => e.ratingKey), state: result.state, positions: result.positions };
    }
    return { order, firstQueue };
  }

  const spec = { A: 190, B: 209, C: 236, D: 212 };

  it('round-robin keeps rotating through the shows instead of replaying the first one', () => {
    const options: InterleaveOptions = { mode: 'round_robin', bufferSize: 7, minConsecutive: 2 };
    const { order } = watchAndRebuild(spec, options, 40);
    // Identical to one long uninterrupted queue, including batches of 2 cut off by the 7-episode buffer
    const intended = interleaveEpisodes(showsAfter(spec, {}), { ...options, bufferSize: 40 }).map((e) => e.showRatingKey);
    expect(order).toEqual(intended);
  });

  it('manual weights keep their pattern across rebuilds (with batches cut off by the buffer)', () => {
    const options: InterleaveOptions = { mode: 'manual_weighted', bufferSize: 5, minConsecutive: 1, maxConsecutive: 2 };
    const { order } = watchAndRebuild(spec, options, 60);
    const intended = interleaveEpisodes(showsAfter(spec, {}), { ...options, bufferSize: 60 }).map((e) => e.showRatingKey);
    expect(order).toEqual(intended);
  });

  for (const mode of ['auto_proportional', 'runtime_balanced'] as const) {
    it(`${mode}: plays the synced queue in order, then keeps every show in rotation`, () => {
      const options: InterleaveOptions = { mode, bufferSize: 30, minConsecutive: 1, maxConsecutive: 2 };
      const { order, firstQueue } = watchAndRebuild(spec, options, 120, { A: 22, B: 22, C: 21, D: 20 });
      expect(order.slice(0, 30)).toEqual(firstQueue);
      const counts: Record<string, number> = {};
      order.forEach((k) => (counts[k] = (counts[k] || 0) + 1));
      for (const key of Object.keys(spec)) {
        expect(counts[key]).toBeGreaterThanOrEqual(20); // ~30 each; before the fix one show got all 120
      }
      let run = 1;
      for (let i = 1; i < order.length; i++) {
        run = order[i] === order[i - 1] ? run + 1 : 1;
        expect(run).toBeLessThanOrEqual(2); // never more than "max in a row"
      }
    });
  }

  it('chronological mode always rebuilds (air-date order is already stable)', () => {
    const shows = [
      { ratingKey: 'A', title: 'A', episodes: makeMockEpisodes('A', 'A', 5) },
      { ratingKey: 'B', title: 'B', episodes: makeMockEpisodes('B', 'B', 5) },
    ];
    const options: InterleaveOptions = { mode: 'chronological', bufferSize: 6 };
    const result = continueSchedule(shows, options, { queue: ['B-s1e1'], state: { credits: {}, nextShow: null, carry: null } });
    expect(result.continued).toBe(false);
    expect(result.episodes.map((e) => e.ratingKey)).toEqual(interleaveEpisodes(shows, options).map((e) => e.ratingKey));
  });

  it('keeps the queue when an episode is watched out of order or a new one is added at the end', () => {
    const options: InterleaveOptions = { mode: 'round_robin', bufferSize: 6 };
    const first = continueSchedule(showsAfter({ A: 10, B: 10 }, {}), options, null);
    const previous = { queue: first.episodes.map((e) => e.ratingKey), state: first.state };
    expect(previous.queue).toEqual(['A-1', 'B-1', 'A-2', 'B-2', 'A-3', 'B-3']);

    // B-2 watched elsewhere (out of order), and a new episode A-11 appeared in the library
    const shows = showsAfter({ A: 11, B: 10 }, {});
    shows[1].episodes = shows[1].episodes.filter((e) => e.ratingKey !== 'B-2');
    const next = continueSchedule(shows, options, previous);
    expect(next.continued).toBe(true);
    expect(next.episodes.map((e) => e.ratingKey)).toEqual(['A-1', 'B-1', 'A-2', 'A-3', 'B-3', 'A-4']);
  });

  it('rebuilds cleanly when an earlier episode becomes unwatched again', () => {
    const options: InterleaveOptions = { mode: 'round_robin', bufferSize: 4 };
    const first = continueSchedule(showsAfter({ A: 10, B: 10 }, { A: 2, B: 2 }), options, null);
    const previous = { queue: first.episodes.map((e) => e.ratingKey), state: first.state };
    // A-1 marked unwatched: it now comes before the kept A-3, so the kept order can't be trusted
    const next = continueSchedule(showsAfter({ A: 10, B: 10 }, { A: 0, B: 2 }), options, previous);
    expect(next.continued).toBe(false);
    expect(next.episodes[0].ratingKey).toBe('A-1');
  });
});

describe('changing the shows keeps the place in the rotation', () => {
  const show = (key: string, watched: number, total = 20, weight = 1): ShowConfig => ({
    ratingKey: key,
    title: key,
    manualWeight: weight,
    episodes: Array.from({ length: total - watched }, (_, i) => ({
      ratingKey: `${key}-${watched + i + 1}`,
      showRatingKey: key,
      showTitle: key,
      seasonNumber: 1,
      episodeNumber: watched + i + 1,
      title: '',
    })),
  });
  const keys = (eps: { ratingKey: string }[]) => eps.map((e) => e.ratingKey);
  const asPrevious = (r: { episodes: EpisodeItem[]; state: SchedulerState; positions: (SchedulerState | null)[] }, replan = true) => ({
    queue: keys(r.episodes),
    state: r.state,
    positions: r.positions,
    replan,
  });

  it('round-robin: an added show takes its turn right away, after the episode that was up next', () => {
    const options: InterleaveOptions = { mode: 'round_robin', bufferSize: 6 };
    const first = continueSchedule([show('A', 0), show('B', 0), show('C', 0)], options, null);
    expect(keys(first.episodes)).toEqual(['A-1', 'B-1', 'C-1', 'A-2', 'B-2', 'C-2']);

    // A-1 and B-1 watched, then show D added after C
    const next = continueSchedule([show('A', 1), show('B', 1), show('C', 0), show('D', 0)], options, asPrevious(first));
    expect(next.replanned).toBe(true);
    expect(keys(next.episodes)).toEqual(['C-1', 'D-1', 'A-2', 'B-2', 'C-2', 'D-2']);
  });

  it('round-robin: a removed show is skipped without restarting the rotation', () => {
    const options: InterleaveOptions = { mode: 'round_robin', bufferSize: 6 };
    const first = continueSchedule([show('A', 0), show('B', 0), show('C', 0), show('D', 0)], options, null);
    // A-1 and B-1 watched, then B removed
    const next = continueSchedule([show('A', 1), show('C', 0), show('D', 0)], options, asPrevious(first));
    expect(keys(next.episodes)).toEqual(['C-1', 'D-1', 'A-2', 'C-2', 'D-2', 'A-3']);
  });

  it('weighted modes: an added show is mixed into the upcoming queue, not parked at the end', () => {
    const options: InterleaveOptions = { mode: 'manual_weighted', bufferSize: 30 };
    const first = continueSchedule([show('A', 0, 200, 2), show('B', 0, 200, 1)], options, null);
    const watchedA = keys(first.episodes.slice(0, 4)).filter((k) => k.startsWith('A')).length;
    const watchedB = 4 - watchedA;
    const previous = asPrevious(first);

    const next = continueSchedule([show('A', watchedA, 200, 2), show('B', watchedB, 200, 1), show('N', 0, 200, 1)], options, previous);
    expect(next.episodes[0].ratingKey).toBe(first.episodes[4].ratingKey); // picks up exactly where it was
    const firstNew = next.episodes.findIndex((e) => e.showRatingKey === 'N');
    expect(firstNew).toBeGreaterThanOrEqual(0);
    expect(firstNew).toBeLessThan(5); // within the next few episodes, not after the 26 already queued
    const share = next.episodes.filter((e) => e.showRatingKey === 'N').length / next.episodes.length;
    expect(share).toBeGreaterThan(0.15); // ~1/4 of the rotation at weight 1 of 4
    expect(share).toBeLessThan(0.35);
  });

  it('changing a weight keeps the place too', () => {
    const options: InterleaveOptions = { mode: 'manual_weighted', bufferSize: 12 };
    const first = continueSchedule([show('A', 0, 100, 1), show('B', 0, 100, 1)], options, null);
    const watched = keys(first.episodes.slice(0, 3));
    const next = continueSchedule(
      [
        show('A', watched.filter((k) => k.startsWith('A')).length, 100, 3),
        show('B', watched.filter((k) => k.startsWith('B')).length, 100, 1),
      ],
      options,
      asPrevious(first)
    );
    expect(next.episodes[0].ratingKey).toBe(first.episodes[3].ratingKey);
    expect(next.episodes.filter((e) => e.showRatingKey === 'A').length).toBeGreaterThan(7); // now ~3:1
  });

  it('data saved before per-episode positions existed: still re-plans, keeping the episode that was up next', () => {
    const options: InterleaveOptions = { mode: 'round_robin', bufferSize: 6 };
    const first = continueSchedule([show('A', 0), show('B', 0), show('C', 0)], options, null);
    // A-1 watched, then D added, with v1.4.15-style saved data (no positions)
    const next = continueSchedule([show('A', 1), show('B', 0), show('C', 0), show('D', 0)], options, {
      queue: keys(first.episodes),
      state: first.state,
      positions: null,
      replan: true,
    });
    expect(next.replanned).toBe(true);
    expect(keys(next.episodes)).toEqual(['B-1', 'C-1', 'D-1', 'A-2', 'B-2', 'C-2']);
  });

  it('repairs a queue that left out a show added before positions were saved (v1.4.16 upgrade case)', () => {
    // Full queue saved by v1.4.15 for four shows; a fifth show was added and saved without a re-plan,
    // so the settings already include it (replan: false) but it has no place in the queue
    const options: InterleaveOptions = { mode: 'manual_weighted', bufferSize: 30 };
    const four = ['A', 'B', 'C', 'D'].map((k) => show(k, 0, 200));
    const first = continueSchedule(four, options, null);
    const legacy = { queue: keys(first.episodes), state: first.state, positions: null, replan: false };

    const withNew = [...four, show('N', 0, 200)];
    const repaired = continueSchedule(withNew, options, legacy);
    expect(repaired.replanned).toBe(true);
    expect(repaired.episodes[0].ratingKey).toBe(first.episodes[0].ratingKey); // same episode still up next
    const firstNew = repaired.episodes.findIndex((e) => e.showRatingKey === 'N');
    expect(firstNew).toBeGreaterThanOrEqual(0);
    expect(firstNew).toBeLessThan(6);
    expect(repaired.positions.every((p) => p !== null)).toBe(true); // full positions saved from now on

    // The next sync continues normally (no repeated re-planning)
    const again = continueSchedule(withNew, options, { queue: keys(repaired.episodes), state: repaired.state, positions: repaired.positions, replan: false });
    expect(again.replanned).toBe(false);
    expect(keys(again.episodes)).toEqual(keys(repaired.episodes));
  });
});

