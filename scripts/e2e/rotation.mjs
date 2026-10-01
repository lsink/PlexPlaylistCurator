// End-to-end test against a running app and the mock Plex server (scripts/mock-plex.mjs). Dev tool only.
// Covers: the rotation continuing across webhook-triggered rebuilds, skipping unchanged rebuilds,
// preview == next sync, rebuilding a playlist deleted in Plex, and settings changes starting over.
//
// Use a FRESH app database and a FRESH mock for each run (both are stateful):
//   node scripts/mock-plex.mjs                                    (terminal 1)
//   PORT=32599 DATA_DIR=/tmp/ppc-e2e npx tsx src/server/index.ts  (terminal 2, after deleting /tmp/ppc-e2e)
//   node scripts/e2e/rotation.mjs                                       (terminal 3)
// Override the URLs with APP_URL / MOCK_URL. Exits non-zero if any check fails.
const B = process.env.APP_URL || 'http://localhost:32599';
const M = process.env.MOCK_URL || 'http://localhost:32498';
const H = { 'Content-Type': 'application/json' };
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const api = async (path, opts = {}) => (await fetch(B + path, { headers: H, ...opts })).json();
const mock = async (path) => (await fetch(M + path)).json();
const plexPlaylists = async () => (await mock('/_state')).playlists;
const webhookRows = () => api('/api/logs/webhooks');
const syncRows = () => api('/api/logs');

const watchedCount = {};
const showName = { 1: 'Alpha', 2: 'Beta', 3: 'Gamma' };
let failures = 0;
const check = (label, ok, extra = '') => {
  console.log(`${ok ? 'PASS' : 'FAIL'}  ${label}${extra ? '  ' + extra : ''}`);
  if (!ok) failures++;
};

await api('/api/settings', { method: 'POST', body: JSON.stringify({ plexUrl: M, plexToken: 'tok' }) });
const { id } = await api('/api/playlists', {
  method: 'POST',
  body: JSON.stringify({ name: 'Mix', mode: 'round_robin', bufferSize: 6, shows: [{ ratingKey: '1', title: 'Alpha' }, { ratingKey: '2', title: 'Beta' }, { ratingKey: '3', title: 'Gamma' }] }),
});

// 1. first sync
let r = await api(`/api/playlists/${id}/sync`, { method: 'POST' });
let pls = await plexPlaylists();
check('first sync builds the playlist', r.success && !r.unchanged && pls.length === 1, `plex id ${pls[0]?.ratingKey}`);
const firstId = pls[0].ratingKey;

// 2. sync again with nothing watched -> no rebuild
r = await api(`/api/playlists/${id}/sync`, { method: 'POST' });
pls = await plexPlaylists();
check('re-sync with no changes skips the rebuild', r.unchanged === true && pls.length === 1 && pls[0].ratingKey === firstId, `plex id still ${pls[0].ratingKey}`);
const logs = await syncRows();
check('manual no-op sync is logged as "No changes"', logs[0]?.message?.startsWith('No changes'), `"${logs[0]?.message}"`);

// 3. scheduled-style no-op is not logged: trigger via sync-all (manual) is logged; use the webhook path for a non-manual no-op below

// 4. watch the first episode, let the webhook rebuild, repeat
const order = [];
for (let i = 0; i < 9; i++) {
  const [pl] = await plexPlaylists();
  const headKey = pl.keys[0];
  const show = Math.floor(Number(headKey) / 10000);
  order.push(showName[show]);
  watchedCount[show] = (watchedCount[show] || 0) + 1;
  await mock(`/_watch_key?key=${headKey}`); // mark exactly the episode at the head as watched
  await fetch(`${B}/api/webhook/plex`, {
    method: 'POST',
    headers: H,
    body: JSON.stringify({ event: 'media.scrobble', Account: { title: 'Lsink' }, Metadata: { type: 'episode', grandparentRatingKey: String(show), grandparentTitle: showName[show], ratingKey: headKey } }),
  });
  await sleep(700);
}
check('watching episode by episode rotates through the shows', order.join(' ') === 'Alpha Beta Gamma Alpha Beta Gamma Alpha Beta Gamma', order.join(' '));

// 5. a webhook for a show whose episode didn't change anything -> "already up to date", no new sync log row
const syncCountBefore = (await syncRows()).length;
const idBefore = (await plexPlaylists())[0].ratingKey;
await fetch(`${B}/api/webhook/plex`, { method: 'POST', headers: H, body: JSON.stringify({ event: 'media.scrobble', Metadata: { type: 'episode', grandparentRatingKey: '1', grandparentTitle: 'Alpha' } }) });
await sleep(700);
const row = (await webhookRows())[0];
check('webhook with nothing new: playlist untouched', (await plexPlaylists())[0].ratingKey === idBefore, `detail "${row.detail}"`);
check('...and it does not add a sync history row', (await syncRows()).length === syncCountBefore);

// 6. preview matches what the next sync pushes
const keysBefore6 = (await plexPlaylists())[0].keys;
const preview = await api(`/api/playlists/${id}/preview`);
await mock(`/_watch_key?key=${keysBefore6[0]}`);
const preview2 = await api(`/api/playlists/${id}/preview`);
r = await api(`/api/playlists/${id}/sync`, { method: 'POST' });
const pushed = (await plexPlaylists())[0].keys;
check('preview shows exactly what the next sync pushes', JSON.stringify(preview2.episodes.map((e) => e.ratingKey)) === JSON.stringify(pushed));
check('with nothing watched, the preview equals the playlist in Plex', JSON.stringify(preview.episodes.map((e) => e.ratingKey)) === JSON.stringify(keysBefore6));

// 7. playlist deleted by hand in Plex -> next sync notices and rebuilds even though the queue is the same
const before7 = (await plexPlaylists())[0];
await fetch(`${M}/playlists/${before7.ratingKey}`, { method: 'DELETE' });
r = await api(`/api/playlists/${id}/sync`, { method: 'POST' });
pls = await plexPlaylists();
check('playlist deleted in Plex gets rebuilt', !r.unchanged && pls.length === 1 && JSON.stringify(pls[0].keys) === JSON.stringify(before7.keys), `new id ${pls[0]?.ratingKey}`);

// 8. changing the playlist's settings starts the rotation over
await api(`/api/playlists/${id}`, { method: 'PUT', body: JSON.stringify({ mode: 'manual_weighted' }) });
r = await api(`/api/playlists/${id}/sync`, { method: 'POST' });
check('changing settings rebuilds with the new mode', r.success && !r.unchanged);

console.log(failures === 0 ? '\nALL PASSED' : `\n${failures} FAILED`);
process.exitCode = failures === 0 ? 0 : 1;
