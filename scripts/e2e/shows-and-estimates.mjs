// End-to-end test against a running app and the mock Plex server (scripts/mock-plex.mjs). Dev tool only.
// Covers: adding/removing a show without restarting the rotation, changing the mode starting over,
// and the finish estimates (pace window, per-show dates, "done", no estimates when watched episodes are included).
//
// Use a FRESH app database and a FRESH mock for each run (both are stateful):
//   node scripts/mock-plex.mjs                                    (terminal 1)
//   PORT=32599 DATA_DIR=/tmp/ppc-e2e npx tsx src/server/index.ts  (terminal 2, after deleting /tmp/ppc-e2e)
//   node scripts/e2e/shows-and-estimates.mjs                                       (terminal 3)
// Override the URLs with APP_URL / MOCK_URL. Exits non-zero if any check fails.
const B = process.env.APP_URL || 'http://localhost:32599';
const M = process.env.MOCK_URL || 'http://localhost:32498';
const H = { 'Content-Type': 'application/json' };
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const api = async (path, opts = {}) => (await fetch(B + path, { headers: H, ...opts })).json();
const mock = async (path) => (await fetch(M + path)).json();
const queueInPlex = async () => (await mock('/_state')).playlists[0].keys;
const showOf = (key) => ({ 1: 'Alpha', 2: 'Beta', 3: 'Gamma' })[Math.floor(Number(key) / 10000)];
let failures = 0;
const check = (label, ok, extra = '') => {
  console.log(`${ok ? 'PASS' : 'FAIL'}  ${label}${extra ? '  ' + extra : ''}`);
  if (!ok) failures++;
};
const watchHead = async () => {
  const [head] = await queueInPlex();
  await mock(`/_watch_key?key=${head}`);
  await fetch(`${B}/api/webhook/plex`, { method: 'POST', headers: H, body: JSON.stringify({ event: 'media.scrobble', Metadata: { type: 'episode', grandparentRatingKey: String(Math.floor(head / 10000)) } }) });
  await sleep(600);
  return showOf(head);
};

await api('/api/settings', { method: 'POST', body: JSON.stringify({ plexUrl: M, plexToken: 'tok' }) });
const alphaBeta = [{ ratingKey: '1', title: 'Alpha' }, { ratingKey: '2', title: 'Beta' }];
const { id } = await api('/api/playlists', { method: 'POST', body: JSON.stringify({ name: 'Mix', mode: 'round_robin', bufferSize: 6, shows: alphaBeta }) });
await api(`/api/playlists/${id}/sync`, { method: 'POST' });
let pl = (await api('/api/playlists')).find((p) => p.id === id);
check('no watch history yet: no pace, no estimates', pl.watchRate === null && pl.shows.every((s) => s.estimatedFinish === null), `watchRate=${pl.watchRate}`);

// ---------- #1: add a show mid-rotation
const watched = [await watchHead(), await watchHead(), await watchHead()];
check('rotation before the change', watched.join(' ') === 'Alpha Beta Alpha', watched.join(' '));
const before = (await queueInPlex()).map(showOf);
await api(`/api/playlists/${id}`, { method: 'PUT', body: JSON.stringify({ shows: [...alphaBeta, { ratingKey: '3', title: 'Gamma' }] }) });
await api(`/api/playlists/${id}/sync`, { method: 'POST' });
const after = (await queueInPlex()).map(showOf);
check('adding Gamma keeps the place: Beta is still up next', before[0] === 'Beta' && after[0] === 'Beta', `before ${before.join(',')} | after ${after.join(',')}`);
check('...and Gamma takes its turn right after it', after[1] === 'Gamma', after.join(','));
const next3 = [await watchHead(), await watchHead(), await watchHead(), await watchHead()];
check('rotation continues through all three shows', next3.join(' ') === 'Beta Gamma Alpha Beta', next3.join(' '));

// removing a show also keeps the place
const beforeRemove = (await queueInPlex()).map(showOf);
await api(`/api/playlists/${id}`, { method: 'PUT', body: JSON.stringify({ shows: [{ ratingKey: '1', title: 'Alpha' }, { ratingKey: '3', title: 'Gamma' }] }) });
await api(`/api/playlists/${id}/sync`, { method: 'POST' });
const afterRemove = (await queueInPlex()).map(showOf);
check('removing Beta: the rotation goes on with the rest', !afterRemove.includes('Beta') && afterRemove[0] === beforeRemove.find((s) => s !== 'Beta'), `before ${beforeRemove.join(',')} | after ${afterRemove.join(',')}`);

// changing the mode still starts over
await api(`/api/playlists/${id}`, { method: 'PUT', body: JSON.stringify({ mode: 'manual_weighted', shows: alphaBeta.concat({ ratingKey: '3', title: 'Gamma' }) }) });
const modeSync = await api(`/api/playlists/${id}/sync`, { method: 'POST' });
check('changing the mode rebuilds', modeSync.success && !modeSync.unchanged);

// ---------- #3: finish estimates

// Old history (60 days ago) must not count; then 21 recent watches (last 2 weeks) => 21/28 = 0.75 episodes/day
for (let n = 100; n < 140; n++) await mock(`/_watch_key?key=${20000 + n}&daysAgo=60`); // old history: must not count
for (let i = 0; i < 21; i++) {
  const show = i % 2 === 0 ? 1 : 2;
  // mark further episodes watched with recent timestamps (keys beyond what the rotation used)
  await mock(`/_watch_key?key=${show * 10000 + 200 + i}&daysAgo=${i % 14}`);
}
await api(`/api/playlists/${id}/sync`, { method: 'POST' });
pl = (await api('/api/playlists')).find((p) => p.id === id);
const recentWatches = 21 + 7; // + the 7 episodes watched through the rotation above (all "today")
check('pace counts only the last 4 weeks', Math.abs(pl.watchRate - recentWatches / 28) < 0.01, `watchRate=${pl.watchRate?.toFixed(3)} expected ${(recentWatches / 28).toFixed(3)}`);
const finish = Object.fromEntries(pl.shows.map((s) => [s.title, s.estimatedFinish]));
check('every show has an estimated finish date', Object.values(finish).every((d) => /^\d{4}-\d{2}-\d{2}$/.test(d)), JSON.stringify(finish));
check('short Gamma finishes first, long Alpha last', finish.Gamma < finish.Beta && finish.Beta < finish.Alpha, JSON.stringify(finish));

// Sanity-check the date maths: Gamma has 7 regular episodes minus those watched; at weight 1:1:1 it runs out around 3x that many episodes in
const preview = await api(`/api/playlists/${id}/preview`);
const gammaLeft = preview.showStats.find((s) => s.title === 'Gamma').episodeCount;
const daysToGamma = (new Date(finish.Gamma) - new Date(new Date().toISOString().slice(0, 10))) / 86400000;
const expected = (gammaLeft * 3) / (recentWatches / 28);
check('Gamma estimate is about (episodes left x 3 shows) / pace', Math.abs(daysToGamma - expected) <= 3, `${daysToGamma} days vs ~${expected.toFixed(1)}`);
check('preview returns the same pace and estimates', preview.watchRate === pl.watchRate && preview.showStats.every((s) => s.estimatedFinish === finish[s.title]));

// A fully watched show is "done"
for (let n = 1; n <= 10; n++) await mock(`/_watch_key?key=${30000 + n}`);
await api(`/api/playlists/${id}/sync`, { method: 'POST' });
pl = (await api('/api/playlists')).find((p) => p.id === id);
check('a finished show is marked done', pl.shows.find((s) => s.title === 'Gamma').estimatedFinish === 'done');

// Playlists that include watched episodes don't advance, so no estimates
await api(`/api/playlists/${id}`, { method: 'PUT', body: JSON.stringify({ unwatchedOnly: false }) });
await api(`/api/playlists/${id}/sync`, { method: 'POST' });
pl = (await api('/api/playlists')).find((p) => p.id === id);
check('no estimates when the playlist includes watched episodes', pl.watchRate === null && pl.shows.every((s) => s.estimatedFinish === null));

console.log(failures === 0 ? '\nALL PASSED' : `\n${failures} FAILED`);
process.exitCode = failures === 0 ? 0 : 1;
