import { describe, it, expect } from 'vitest';
import {
  interleaveEpisodes,
  ShowConfig,
  EpisodeItem,
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
});
