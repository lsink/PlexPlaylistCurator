// Regression check for the scheduling engine (dev tool only).
//
// Compares the stateless output of the current src/server/engine/interleaveEngine.ts against the version at a git
// revision, on thousands of random playlists (all modes, empty shows, fractional weights, missing air dates and
// runtimes, unlimited buffers). Use it whenever you touch the engine: stateless output must not change unless
// that is the point of the change.
//
//   npx tsx scripts/compare-engine.ts [git-revision=HEAD] [count=2000]
import { execSync } from 'child_process';
import { writeFileSync, rmSync } from 'fs';
import { pathToFileURL } from 'url';
import path from 'path';

const revision = process.argv[2] || 'HEAD';
const count = Number(process.argv[3]) || 2000;

const oldSource = execSync(`git show ${revision}:src/server/engine/interleaveEngine.ts`, { encoding: 'utf8' });
const oldPath = path.resolve('scripts', `.engine-${Date.now()}.tmp.ts`);
writeFileSync(oldPath, oldSource);

try {
  const OLD = await import(pathToFileURL(oldPath).href);
  const NEW = await import(pathToFileURL(path.resolve('src/server/engine/interleaveEngine.ts')).href);

  let seed = 12345;
  const rnd = () => (seed = (seed * 1103515245 + 12345) % 2147483648) / 2147483648;
  const modes = ['round_robin', 'auto_proportional', 'manual_weighted', 'chronological', 'runtime_balanced'];

  let differences = 0;
  for (let t = 0; t < count; t++) {
    const shows = Array.from({ length: 1 + Math.floor(rnd() * 6) }, (_, s) => ({
      ratingKey: `S${s}`,
      title: `S${s}`,
      manualWeight: rnd() < 0.3 ? 1 + Math.floor(rnd() * 5) : rnd() < 0.5 ? 1 + rnd() * 3 : 1,
      episodes: Array.from({ length: Math.floor(rnd() * 60) }, (_, i) => ({
        ratingKey: `S${s}e${i}`,
        showRatingKey: `S${s}`,
        showTitle: `S${s}`,
        seasonNumber: 1 + Math.floor(i / 10),
        episodeNumber: (i % 10) + 1,
        title: '',
        airDate: rnd() < 0.9 ? `20${10 + Math.floor(rnd() * 10)}-0${1 + Math.floor(rnd() * 9)}-1${Math.floor(rnd() * 9)}` : undefined,
        duration: rnd() < 0.9 ? 600000 + Math.floor(rnd() * 3000000) : undefined,
      })),
    }));
    const min = 1 + Math.floor(rnd() * 3);
    const options = {
      mode: modes[t % modes.length],
      bufferSize: rnd() < 0.1 ? 0 : 1 + Math.floor(rnd() * 120),
      minConsecutive: min,
      maxConsecutive: min + Math.floor(rnd() * 3),
    };
    const before = OLD.interleaveEpisodes(shows, options).map((e: any) => e.ratingKey).join(',');
    const after = NEW.interleaveEpisodes(shows, options).map((e: any) => e.ratingKey).join(',');
    if (before !== after) {
      differences++;
      if (differences <= 3) console.log('Different output for', JSON.stringify(options), `with ${shows.length} shows`);
    }
  }
  console.log(`${count} random playlists compared against ${revision}: ${differences} differences`);
  process.exitCode = differences === 0 ? 0 : 1;
} finally {
  rmSync(oldPath, { force: true });
}
