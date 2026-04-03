# AGENTS.md -- AI Navigation Guide for PhotoGroup

This file helps AI coding agents quickly understand and navigate the PhotoGroup codebase.

## What This Project Is

P2P photo sharing web app. Users create rooms, drop photos, and share them directly browser-to-browser via WebTorrent/WebRTC. Server coordinates room state and magnet links but photos transfer peer-to-peer when possible.

## Key Decisions

- **ES Modules throughout** -- both server and UI use `import/export`, no CommonJS
- **No database** -- all state is in-memory on the server (rooms, peers, photos)
- **WebTorrent for P2P** -- not a custom WebRTC solution; uses BitTorrent protocol over WebRTC
- **SSE not WebSocket for updates** -- real-time room updates use Server-Sent Events, not socket.io
- **Vite, not CRA** -- migrated from create-react-app to Vite

## Entry Points

| What | File | Notes |
|------|------|-------|
| Server start | `server/app.js` | Creates Express app, initializes all services, listens on :8081 |
| UI start | `ui/src/index.js` | React 19 createRoot, renders `<App />` |
| Build config | `ui/vite.config.js` | Dev server :3000, proxies /api to :8081, Node.js polyfills |
| Tests (all) | `package.json` → `test` script | Runs `test-all.js` which parallelizes server + UI tests |
| CI/CD | `.github/workflows/test.yml` + `deploy.yml` | Test on push, deploy on success |

## Server Architecture

All server modules are classes instantiated in `app.js`. They receive the Express `app` and register their own routes/middleware.

```
app.js
 ├── ServerSetup(app)     -- middleware: compression, CORS, security headers, static files
 ├── IceServers(app)      -- GET /api/__rtcConfig__ (Twilio STUN/TURN)
 ├── Tracker(server)      -- WebSocket BitTorrent tracker on :9000
 └── Rooms(app, iceServers, tracker)
      ├── Peers           -- peer tracking, IP geolocation via IpTranslator
      ├── ServerPeer      -- server-side WebTorrent client (one per room)
      └── Topology        -- analyzes connection types (direct/relay/NAT)
```

### API Pattern

All routes are registered in `Rooms.js`. Pattern: `POST /api/rooms/` (create), `GET/POST /api/rooms/:id` (get/join), sub-resources for photos, connections, updates (SSE).

### Important: No persistence

Everything is in memory. Server restart = all rooms/photos gone. This is by design for the experimental stage.

## UI Architecture

```
App.js (theme, layout)
 └── ShareCanvas.js (main container)
      ├── RoomsService.js    -- state management, API calls, SSE subscription
      ├── header/            -- Settings, Uploader, AddPeersView (QR codes)
      ├── gallery/           -- photo grid display
      ├── torrent/           -- TorrentMaster (WebTorrent browser client)
      ├── metadata/          -- EXIF/XMP extraction and display
      ├── topology/          -- network graph visualization (vis-react)
      └── security/          -- encryption features
```

### State Management

No Redux/Zustand -- state lives in `RoomsService.js` which is a plain class managing room state, peer lists, and photo arrays. Components subscribe via React patterns.

## Testing

| Type | Location | Runner | Command |
|------|----------|--------|---------|
| UI unit | `ui/src/**/*.test.js` | Vitest | `cd ui && npm test` |
| Server unit | `server/tests/unit/` | Mocha | `cd server && npm test` |
| Server API | `server/tests/api/` | Mocha + Supertest | (included in server tests) |
| Server integration | `server/tests/integration/` | Mocha | (included in server tests) |
| E2E | `ui/e2e/tests/` | Playwright | `cd ui && npm run test:e2e` |

**Test setup files:**
- `server/tests/test-setup.js` -- suppresses console output during tests
- `ui/src/setupTests.js` -- jsdom env, polyfills
- `ui/playwright.config.js` -- auto-starts both servers for E2E

## Common Tasks

### Add a new API endpoint
1. Add route in `server/Rooms.js` (all routes are here)
2. Add API test in `server/tests/api/`
3. Call from UI via `RoomsService.js`

### Add a new UI feature
1. Create component under `ui/src/share/`
2. Wire into `ShareCanvas.js` or appropriate parent
3. Add unit test as `*.test.js` alongside component

### Modify P2P behavior
- Server-side torrent handling: `server/ServerPeer.js`
- Browser-side torrent handling: `ui/src/share/torrent/TorrentMaster.js`
- Connection analysis: `server/Topology.js`

### Change deployment
- Docker config: `Dockerfile`, `docker-compose.yml`
- GCP scripts: `create-vm.sh`, `deploy-docker.sh`, `deploy-nginx.sh`
- CI/CD: `.github/workflows/deploy.yml`

## Secrets & Config

- Twilio credentials: `server/secret/index.js` (gitignored) or env vars
- In CI: GitHub Secrets → written to `server/secret/index.js` during workflow
- No `.env` files used -- secrets are either in the secret module or env vars

## Gotchas

- `ui/public/parsetorrent.js` is a browserified bundle of parse-torrent, not source code -- don't edit it
- `server/ui/` contains the built UI copied during deploy -- it's gitignored, not source
- The WebSocket tracker port (9000) must be accessible alongside the HTTP port (8081)
- Node.js polyfills in `ui/src/compatibility/` and `ui/vite.config.js` are required because WebTorrent uses Node.js APIs
- `wrtc` npm package (native WebRTC for Node.js) can be tricky to install on some platforms

## Cursor Cloud specific instructions

### Node.js version
This project requires Node.js >= 24.0.0. The VM update script handles installing it via `nvm`.

### Running services for development
- **Backend server**: `cd server && node app.js` — runs on port 8081, also starts the WebSocket BitTorrent tracker on port 9000
- **UI dev server**: `cd ui && npx vite --host 0.0.0.0` — runs on port 3000, proxies `/api` to the backend
- Both must be running for full functionality. Start the backend first.

### Running tests
- Server tests (98 tests, Mocha): `cd server && npm test`
- UI unit tests (72 tests, Vitest): `cd ui && npm test -- --run`
- E2E tests (Playwright): `cd ui && npm run test:e2e` — auto-starts both servers via `playwright.config.js`
- All tests: `node test-all.js` (note: `test-all.js` uses CommonJS `require()`, not ES modules)

### No external services required
No database, Redis, or Docker needed for development. All state is in-memory. Twilio credentials are optional (only needed for TURN relay NAT traversal; app falls back to Google STUN servers without them).

### GCP Cloud access
Deployment uses `gcloud` CLI authenticated with a service account key (JSON). **Cursor agents** use the secret `GCP_DEPLOY` (set in Cursor Secrets, personal scope, all repos). To authenticate:
```bash
echo "$GCP_DEPLOY" > /tmp/gcp-key.json
gcloud auth activate-service-account --key-file=/tmp/gcp-key.json
gcloud config set project photogroup-215600
rm /tmp/gcp-key.json
```
GCP project: `photogroup-215600`, zone: `asia-east2-a`, VM instance: `main`. Deployment scripts: `deploy-docker.sh`, `deploy-nginx.sh`, `deploy-app.sh`. See `DEPLOYMENT.md` for full details.

> **Note:** Claude Code agents use `GCP_SERVICE_ACCOUNT_KEY` instead of `GCP_DEPLOY` for the same purpose. See `CLAUDE.md` for Claude-specific instructions.
