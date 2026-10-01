// Minimal mock Plex Media Server for local testing, so the app can be exercised end to end without a real Plex.
// Dev tool only: not used by the app at runtime.
//
//   node scripts/mock-plex.mjs            (listens on MOCK_PLEX_PORT, default 32498)
//
// Then point the app at it: Settings -> Plex URL http://localhost:32498, any token.
// The library has one TV section with three shows:
//   1 "Alpha" 400 episodes, 2 "Beta" 300 episodes, 3 "Gamma" 10 episodes (the first 3 are Season 0 specials).
// Episode ratingKeys are show * 10000 + n (Alpha's first episode is 10001). State is in memory: restart to reset.
//
// Test helpers (not part of the Plex API):
//   GET /_watch?show=1&n=5[&daysAgo=3]    mark the first n episodes of a show watched (lastViewedAt = now - daysAgo)
//   GET /_watch_key?key=10001[&daysAgo=3] mark one episode watched
//   GET /_state                           playlists the app created, with their item keys in order
import http from 'http';

const PORT = Number(process.env.MOCK_PLEX_PORT) || 32498;

const shows = {
  1: { title: 'Alpha', count: 400 },
  2: { title: 'Beta', count: 300 },
  3: { title: 'Gamma', count: 10 },
};
const watched = new Map(); // episode ratingKey -> lastViewedAt (unix seconds)
let playlists = []; // { ratingKey, title, keys: [episode ratingKeys in order] }
let nextPlaylistKey = 9000;

const episodeKey = (show, n) => show * 10000 + n;
const secondsAgo = (days) => Math.floor(Date.now() / 1000) - Number(days || 0) * 86400;
const send = (res, obj, code = 200) => {
  res.writeHead(code, { 'Content-Type': 'application/json' });
  res.end(JSON.stringify(obj));
};
// The app sends playlist items as one server:// URI ending in comma-separated rating keys
const keysFromUri = (uri) => (uri || '').split('/').pop().split(',').filter(Boolean);

http
  .createServer((req, res) => {
    const url = new URL(req.url, 'http://mock');
    const p = url.pathname;
    let m;

    if (p === '/identity') return send(res, { MediaContainer: { machineIdentifier: 'mockmachine' } });
    if (p === '/') return send(res, { MediaContainer: { friendlyName: 'Mock Plex', version: '1.0', platform: 'Mock' } });
    if (p === '/library/sections') {
      return send(res, { MediaContainer: { Directory: [{ key: '1', title: 'TV', type: 'show', uuid: 'mock-tv' }] } });
    }
    if (p === '/library/sections/1/all') {
      return send(res, {
        MediaContainer: {
          Metadata: Object.entries(shows).map(([id, s]) => ({ ratingKey: id, title: s.title, leafCount: s.count, viewedLeafCount: 0, childCount: 1 })),
        },
      });
    }

    if ((m = p.match(/^\/library\/metadata\/(\d+)\/allLeaves$/))) {
      const id = Number(m[1]);
      const show = shows[id];
      if (!show) return send(res, {}, 404);
      const Metadata = Array.from({ length: show.count }, (_, i) => {
        const n = i + 1;
        const key = String(episodeKey(id, n));
        return {
          ratingKey: key,
          grandparentRatingKey: String(id),
          grandparentTitle: show.title,
          parentIndex: id === 3 ? (n <= 3 ? 0 : 1) : Math.ceil(n / 20),
          index: id === 3 ? (n <= 3 ? n : n - 3) : ((n - 1) % 20) + 1,
          title: `${show.title} episode ${n}`,
          duration: 1500000,
          viewCount: watched.has(key) ? 1 : 0,
          lastViewedAt: watched.get(key),
          originallyAvailableAt: '2020-01-01',
        };
      });
      return send(res, { MediaContainer: { Metadata } });
    }
    if ((m = p.match(/^\/library\/metadata\/(\d+)$/))) {
      const id = Number(m[1]);
      const show = shows[id];
      if (!show) return send(res, {}, 404);
      const viewed = [...watched.keys()].filter((k) => Math.floor(Number(k) / 10000) === id).length;
      return send(res, {
        MediaContainer: {
          Metadata: [{ ratingKey: String(id), title: show.title, leafCount: show.count, viewedLeafCount: viewed, childCount: Math.ceil(show.count / 20) }],
        },
      });
    }
    if (p === '/:/unscrobble') {
      const id = Number(url.searchParams.get('key'));
      for (const k of [...watched.keys()]) if (Math.floor(Number(k) / 10000) === id) watched.delete(k);
      return send(res, {});
    }

    if (p === '/playlists' && req.method === 'GET') return send(res, { MediaContainer: { Metadata: playlists } });
    if (p === '/playlists' && req.method === 'POST') {
      const playlist = { ratingKey: String(nextPlaylistKey++), title: url.searchParams.get('title'), keys: keysFromUri(url.searchParams.get('uri')) };
      playlists.push(playlist);
      return send(res, { MediaContainer: { Metadata: [playlist] } });
    }
    if ((m = p.match(/^\/playlists\/(\d+)\/items$/))) {
      const playlist = playlists.find((x) => x.ratingKey === m[1]);
      if (!playlist) return send(res, {}, 404);
      if (req.method === 'GET') {
        return send(res, { MediaContainer: { size: playlist.keys.length, Metadata: playlist.keys.map((k) => ({ ratingKey: k })) } });
      }
      if (req.method === 'PUT') {
        playlist.keys.push(...keysFromUri(url.searchParams.get('uri')));
        return send(res, {});
      }
    }
    if ((m = p.match(/^\/playlists\/(\d+)$/)) && req.method === 'DELETE') {
      playlists = playlists.filter((x) => x.ratingKey !== m[1]);
      return send(res, {});
    }

    // ---- test helpers
    if (p === '/_watch') {
      const id = Number(url.searchParams.get('show'));
      const n = Number(url.searchParams.get('n'));
      for (let i = 1; i <= n; i++) watched.set(String(episodeKey(id, i)), secondsAgo(url.searchParams.get('daysAgo')));
      return send(res, { watched: watched.size });
    }
    if (p === '/_watch_key') {
      watched.set(url.searchParams.get('key'), secondsAgo(url.searchParams.get('daysAgo')));
      return send(res, { watched: watched.size });
    }
    if (p === '/_state') return send(res, { playlists });

    send(res, {}, 404);
  })
  .listen(PORT, () => console.log(`Mock Plex listening on http://localhost:${PORT}`));
