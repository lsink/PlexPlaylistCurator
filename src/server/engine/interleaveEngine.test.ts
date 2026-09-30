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
});
