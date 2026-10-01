# AGENTS.md: guide for AI assistants (and humans) working on this repo

Plex Playlist Curator ("Plex Interleaved Playlist Creator") builds Plex playlists that **interleave episodes from
several TV shows while keeping each show in order**, and keeps them current as you watch. It is a single Node.js
service (Express + SQLite) with a React dashboard, deployed to a Proxmox LXC container (or Docker).

Read this before changing anything. The "Plex gotchas" and "Invariants" sections record things that were learned
the hard way and are easy to regress.

## Commands

```bash
npm install
npm run dev                               # tsx watch server (:32500) + Vite client (:5173, proxies /api)
npm test                                  # Vitest: engine unit tests (src/**/*.test.ts)
npx tsc --noEmit -p tsconfig.json         # type-check the client
npx tsc --noEmit -p tsconfig.server.json  # type-check the server
npm run build                             # vite build -> dist/public, tsc -> dist/server
npm start                                 # node dist/server/index.js
```

There is no lint script. Node >= 22. The server serves the **built** client from `dist/public`, so run
`npx vite build` before checking UI changes against a server started with `npx tsx src/server/index.ts`.

Environment: `PORT` (default 32500), `DATA_DIR` (default `./data`), optional `SESSION_SECRET`, optional
`TRUST_PROXY` (see README). `LIBRARY_SYNC_DEBOUNCE_MS` / `LIBRARY_SYNC_MAX_WAIT_MS` exist only for tests.

## Repo map

```
src/server/
  index.ts                 Express app: session (SQLite store), routes, static client, global error handler
  engine/interleaveEngine.ts   Pure scheduling logic (no I/O). Unit-tested in interleaveEngine.test.ts
  services/syncService.ts  Sync pipeline, preview, finish estimates, webhook handling (scrobble + library.new)
  services/syncScheduler.ts    setInterval background sync
  plex/plexService.ts      Plex HTTP API client (axios). Builds/replaces Plex playlists
  routes/                  auth, settings, plex (proxy/search/status), playlists (CRUD, sync, preview,
                           export/import), webhook, logs (sync history + webhook activity)
  db/schema.ts             CREATE TABLE IF NOT EXISTS ... for fresh databases
  db/index.ts              opens SQLite (WAL, busy_timeout) + additive ALTER TABLE migrations
  db/sessionStore.ts       express-session store in SQLite
  config/sessionSecret.ts  SESSION_SECRET or a generated per-install secret in DATA_DIR/session-secret
  middleware/auth.ts       requireAuth (open when no admin password is set)
src/client/src/
  App.tsx, components/     Dashboard, PlaylistCard, PlaylistEditorModal, ShowPickerModal, QueuePreviewModal
                           (+ QueueDiffPanel, VirtualList), SettingsModal, SyncLogsModal (Syncs + Webhook
                           activity tabs), LoginModal, ConfirmDialog (useConfirm), ErrorBoundary
  context/SettingsContext.tsx  settings + Plex health polling (useSettings)
  hooks/useModalA11y.ts    focus trap / Escape / focus restore for modals
  api/client.ts            fetch wrapper; any 401 dispatches 'auth-expired' (App reopens login)
  utils/format.ts          parseDbTimestamp (SQLite UTC), poster URL, durations, finish/pace text
scripts/mock-plex.mjs      mock Plex server for local testing (dev only)
scripts/e2e/*.mjs          end-to-end checks against a running app + the mock (dev only)
scripts/compare-engine.ts  engine regression check: stateless output vs a git revision (dev only)
deploy/                    Proxmox LXC create/install/update scripts, systemd unit
```

## How a sync works (`SyncService.runPlaylistSync`)

1. **Fetch** every show's episodes from Plex (`/library/metadata/<show>/allLeaves`), unwatched-only if the
   playlist says so, minus Season 0 unless `include_specials`. If any show fails, the sync fails (by design).
   The same request yields `lastViewedAt` watch times used for the pace.
2. **Schedule** with `continueSchedule()` (engine): keep the previously synced queue's order, drop episodes no
   longer eligible, and extend by continuing the rotation from the saved scheduler state. If the playlist's
   shows/order/weights changed, **re-plan** the upcoming queue from the current point in the rotation instead
   (per-episode saved positions). If the mode or other settings changed, start fresh.
3. **Estimate** finish dates (best effort, never fails a sync): pace = watches of these shows in the last 28 days;
   plan every remaining episode in rotation order; a show finishes when its last episode comes up.
4. **Skip if unchanged**: if the queue equals the last pushed one and Plex still holds exactly those items
   (`GET /playlists/<id>/items`), leave Plex alone (the playlist keeps its ID). No-op syncs are logged only when
   triggered manually.
5. **Push** otherwise: create a new Plex playlist, add items in batches of 50 (one `server://` URI with
   comma-separated keys, single-item fallback), then delete the previous playlist **by its stored ID**. A failed
   build deletes the partial new playlist and leaves the old one intact.
6. **Save** `plex_playlist_id`, `last_synced_queue` (snapshot for the diff view and continuation),
   `schedule_state` (`{ end, positions }`), `schedule_config`, and a `sync_logs` row.

Triggers: manual (UI), `sync-all`, the scheduler, webhooks (`media.scrobble` for a show in an enabled playlist), and
`library.new` (debounced per playlist: 30 s of quiet, max 5 min). A per-playlist lock prevents overlap; a webhook
arriving mid-sync queues exactly one follow-up sync.

## Invariants (don't break these)

- **Within-show order is sacred**: episodes of a show always appear in season/episode order.
- **Stateless engine output is frozen**: `interleaveEpisodes()` / `interleaveWithState(..., null)` must produce
  the same sequences as before. When touching the engine, run `npx tsx scripts/compare-engine.ts` (compares
  against HEAD on 2,000 random playlists; pass another git revision as the first argument) and keep the tests
  passing. Only change stateless output deliberately, and update the test expectations in the same change.
- **Rebuilding must not restart the rotation**: that was the v1.4.15 bug (one show replayed after every watched
  episode). The `continueSchedule` tests simulate "watch the first episode, rebuild, repeat" and must keep passing.
- **Never delete a Plex playlist the app didn't create**: delete only by stored `plex_playlist_id`; a first sync
  refuses if an unmanaged playlist has the same title; Plex titles are unique (case-insensitive) across app playlists.
- **Never log raw axios errors**: they contain the `X-Plex-Token` header. `PlexService` rethrows sanitized errors
  via an axios interceptor; keep it that way and log `err.message`.
- **Internal columns stay out of API responses**: `last_synced_queue`, `schedule_state`, `schedule_config` are
  stripped in `playlistRoutes`. The webhook secret is never returned by `GET /api/settings` (only
  `hasWebhookSecret`; `GET /api/settings/webhook-secret` reveals it to a signed-in admin).
- **Timestamps**: SQLite `CURRENT_TIMESTAMP` is UTC without a zone marker; the client must parse with
  `parseDbTimestamp()`, never `new Date(str)`.
- **Schema changes** go in both `db/schema.ts` (fresh installs) and `db/index.ts` (additive `ALTER TABLE` in
  try/catch for existing installs). SQLite can't alter column types/constraints on existing tables.

## Plex gotchas

Items marked (verified) were confirmed on the maintainer's real Plex server; the rest come from Plex's behaviour as
documented or observed only through the mock.

- **Webhooks are `multipart/form-data`** with a `payload` JSON field (plus an optional thumbnail) (verified).
  Parsed with multer; JSON and urlencoded bodies are accepted too.
- **Plex strips the query string from webhook URLs** (verified). The secret therefore goes in the path:
  `POST /api/webhook/plex/<secret>` (header `X-Webhook-Secret` and `?secret=` still work for other callers).
  The secret is checked before the body is parsed; rejections are recorded with the reason (lengths only).
- Plex sends **every** event (play, pause, resume, stop, scrobble, rate, library.new, library.on.deck, ...).
  Only `media.scrobble` (episode, ~90% watched) and matching `library.new` cause syncs. Other `library.*` events
  are dropped silently; everything else is recorded in Webhook activity (`webhook_events`, newest 200).
- Webhook events carry `Account.title` and `Player.title` (verified; shown in Webhook activity).
- A sync while someone is watching is safe (verified once, on one client): Plex clients play from a snapshot play queue, so playback and
  autoplay continue; the new order applies the next time the playlist is started.
- Watch state is per Plex account: the app uses the token owner's watch history.
- Opening the webhook URL in a browser returns a 405 with an explanation (it only accepts POST).

## Testing a change

1. `npm test` and both `tsc --noEmit` commands; for engine changes also `npx tsx scripts/compare-engine.ts`.
2. For server/sync behaviour, run the end-to-end checks against the mock Plex (fresh database and fresh mock
   each time; both are stateful):
   ```bash
   node scripts/mock-plex.mjs                                     # terminal 1
   PORT=32599 DATA_DIR=/tmp/ppc-e2e npx tsx src/server/index.ts   # terminal 2 (delete /tmp/ppc-e2e first)
   node scripts/e2e/rotation.mjs                                  # or scripts/e2e/shows-and-estimates.mjs
   ```
   Point the app at the mock with `POST /api/settings {"plexUrl":"http://localhost:32498","plexToken":"x"}`
   (the e2e scripts do this). Mock helpers: `/_watch`, `/_watch_key`, `/_state` (see the file header).
3. For UI changes: `npx vite build`, start the server, and check in a browser.
4. Things the mock can't prove (real Plex API details, client behaviour) need a check on a real server; say so
   when reporting results rather than implying they were verified.

## Conventions

- TypeScript, ES modules; server imports use the `.js` suffix (`'../db/index.js'`).
- Comments explain *why* (constraints, past bugs), not what the code does. Match the surrounding style.
- DB columns are snake_case; API responses map to camelCase (`includeSpecials`, `watchRate`, `estimatedFinish`).
- Client: modals use `useModalA11y` + `role="dialog"`; confirmations use `useConfirm()` (never `window.confirm`
  or `alert`); settings come from `useSettings()`.

## Releasing

- Version lives in `package.json` (and `package-lock.json`, two places near the top); `APP_VERSION` reads it.
  Bump the patch version for each release (`1.4.x`).
- Commit message: `vX.Y.Z: <summary>` with a short bullet body explaining what changed and why.
- Commit and push only when the maintainer asks.
- Deploying: on the LXC, run `update` (or `plex-update`), i.e. `deploy/update-lxc.sh`: fetch, `git reset --hard
  origin/main`, `npm install`, `npm run build`, restart the systemd service. Schema migrations run on startup.

## Backlog / ideas (not started)

- Update the Plex playlist **in place** (remove watched items, append new ones) so its ID never changes;
  fall back to rebuild for big reorders. The saved queue makes this practical.
- Weight rounding: manual weights are rounded (1.5x acts as 2x) and batch-size adjustment distorts ratios
  (3:2 with batching comes out 2:1). Fix by keeping weights as floats in SWRR; update test expectations.
- Round-robin ignores "max in a row" (uses the minimum only).
- "Pick up where I left off" (ignore old unwatched gaps), per-show start point, loop/drop finished shows,
  pause a show, "up next" on cards, webhook account filter, multiple Plex users, failure notifications.
- Keep two-part episodes together; movies in chronological mode; custom watch orders; size a playlist by time;
  skip individual episodes; playlists from Plex collections/labels.
- Updater safety: back up `app.db` before migrations; build into a temp dir before replacing `dist/`.
