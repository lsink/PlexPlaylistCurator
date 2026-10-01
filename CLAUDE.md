# CLAUDE.md

The project guide lives in AGENTS.md (shared with other AI tools). Read it first:

@AGENTS.md

## Notes for Claude Code

- Before reporting a change as done: `npm test`, both `tsc --noEmit` checks, and for sync/webhook behaviour the
  `scripts/e2e/` checks against `scripts/mock-plex.mjs` (fresh `DATA_DIR` and fresh mock per run).
- Use a non-default port (e.g. 32599) and a temp `DATA_DIR` for test servers so you never touch a real database,
  and stop the servers you start.
- Don't commit or push unless asked. Releases follow the "Releasing" section of AGENTS.md.
