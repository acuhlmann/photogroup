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
- **Wake proxy + auto-stop** -- public DNS hits Cloud Run (`wake-proxy/`); GCE VM starts on demand and idle-stops; ephemeral IP (no static IP) for ~$0 idle cost. The VM `main` is in `us-central1-a`.

## Entry Points

| What | File | Notes |
|------|------|-------|
| Server start | `server/app.js` | Creates Express app, initializes all services, listens on :8081 |
| UI start | `ui/src/index.js` | React 19 createRoot, renders `<App />` |
| Build config | `ui/vite.config.mjs` | Dev server :3000, proxies /api to :8081, Node.js polyfills |
| Wake proxy | `wake-proxy/src/index.js` | Cloud Run ingress: start VM, cold-start page, HTTP/WS proxy |
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

### Production ingress (wake proxy)

```
Cloud Run photogroup-wake (wake-proxy/)
  → GCE start/stop + HTTPS proxy
  → VM nginx (:443) → Docker photogroup-app (:8081/:9000)
                     → Docker hackersbot (:18080)
VM timer photogroup-idle-stop → stop instance after nginx idle
```

Deploy: `./deploy-wake-proxy.sh` then point DNS at Cloud Run; release static IP with `./release-static-ip.sh`. See `DEPLOYMENT.md`.

### API Pattern

All routes are registered in `Rooms.js`. Pattern: `POST /api/rooms/` (create), `GET/POST /api/rooms/:id` (get/join), sub-resources for photos, connections, updates (SSE).

Shared photo details (title, description, rating, keywords and location anyone in the room can edit) go through `PUT /api/rooms/:id/photos/details`, validated in `server/PhotoDetails.js` and gated on the caller's session token; the generic `PUT /api/rooms/:id/photos/` ignores `details`. In the UI they live on `tile.details` and override the file's embedded XMP (`groupPhotoMetadata.js`). Saving a photo writes them into the file's own metadata (`gallery/metadata/embed/`: XMP for JPEG/PNG/WebP/HEIC/AVIF, iTunes tags for MP4/MOV/M4A, ID3 for MP3, Vorbis comments for FLAC and Ogg Vorbis/Opus (repaged with fresh CRCs), XMP application extension for GIF, LIST/INFO plus an `id3 ` chunk for WAV, Matroska `Tags` for MKV/WebM: rewritten in place before the first Cluster when Void padding allows, else appended with the SeekHead and Segment size patched); other formats download unchanged. "Download room" in the gallery toolbar (`gallery/saveRoom.js`, `client-zip`) saves every photo that is here in full the same way, one zip for the room. Missing fields are prompted for in the detail panel, and gallery tiles edit the title, description, rating and keywords in place (`metadata/InlineText.js`, `StarPicker`, `KeywordEditor`).

Location comes from EXIF/XMP GPS, HEIC Exif items and video `udta`/`meta` boxes (`metadata/geo.js`, `embed/heif.js`, `embed/mp4.js`) and shows as a map card (`metadata/LocationCard.js`) using OpenStreetMap tiles and Nominatim reverse geocoding (cached, one lookup per second), with Google Maps, Amap and OSM links. GPS fields present but blank (Android zeroes them when a browser picks a photo without location access) become `x-Location status: 'blank'` and show a "Location removed before upload" note instead of NaN rows. To keep that from happening, Share on Android opens the system Files picker (`header/pickFiles.js`, `showOpenFilePicker`) rather than the file input, whose chooser offers gallery apps and the photo picker, both of which blank the location; keep `audio/*` in the input's `accept`, since image/video-only makes Chrome open the photo picker. Files picked on Android that still show Android's blanking (`metadata/strippedLocation.js`: EXIF GPS latitude/longitude zeroed down to 0/0 denominators, or an MP4 location box with its type wiped) are held back in `Uploader.js` with directions to pick them from internal storage › DCIM, or shared without location if the person asks. People can set or change a location (`metadata/LocationEditor.js`: Nominatim place search, device position, or dragging a `TileMap` under the pin) or hide the file's with `location: null`; saving writes it as XMP `exif:GPS*`, fills JPEG EXIF GPS fields in place when they exist (`embed/exifGps.js`), and as `©xyz` in MP4/MOV.

The gallery toolbar (`gallery/GalleryToolbar.js`) sorts and filters tiles through `gallery/arrangeTiles.js` (rating, date taken, place grouped by town and country, text search over titles, descriptions, keywords and places) and switches to `gallery/RoomMap.js`, which pins every located photo on one map; the viewer pages through the tiles the current view shows.

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
- Optional `WAKE_STOP_SECRET` GitHub Secret → enables Cloud Run `/__wake__/stop` for Scheduler backups
- Wake proxy bot filter + optional Cloudflare Bot Fight Mode — keep scanner traffic from starting/keeping the GCE VM awake (see `wake-proxy/README.md`)
- No `.env` files used -- secrets are either in the secret module or env vars

## Gotchas

- `ui/public/parsetorrent.js` is a browserified bundle of parse-torrent, not source code -- don't edit it
- `server/ui/` contains the built UI copied during deploy -- it's gitignored, not source
- The WebSocket tracker port (9000) must be accessible alongside the HTTP port (8081)
- Node.js polyfills in `ui/src/compatibility/` and `ui/vite.config.mjs` are required because WebTorrent uses Node.js APIs
- `wrtc` npm package (native WebRTC for Node.js) can be tricky to install on some platforms
- Production DNS should target Cloud Run (`photogroup-wake`), not the VM IP; the VM uses an ephemeral IP that changes on each start
- CI deploy starts the VM if it was idle-stopped before pushing nginx/Docker updates

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
- Wake proxy unit tests: `cd wake-proxy && npm test`
- E2E tests (Playwright): `cd ui && npm run test:e2e` — auto-starts both servers via `playwright.config.js`
- All tests: `node test-all.js` (note: `test-all.js` uses CommonJS `require()`, not ES modules)

### No external services required
No database, Redis, or Docker needed for development. All state is in-memory. Twilio credentials are optional (only needed for TURN relay NAT traversal; app falls back to Google STUN servers without them).

### Production wake / cost control
- Deploy wake proxy: `./deploy-wake-proxy.sh`
- Release static IP after DNS cutover: `./release-static-ip.sh`
- Idle stop runs on the VM via `photogroup-idle-stop.timer` (default 60 minutes)

### Pushing changes
Always push to `main`. Before pushing:
1. Run all tests locally: `npm test` (runs both server and UI tests via `test-all.js`)
2. Verify the push succeeded by checking the GitHub Actions results at https://github.com/acuhlmann/photogroup/actions

### GCP Cloud access
Deployment uses `gcloud` CLI authenticated with a service account key (JSON). The secret `GCP_SERVICE_ACCOUNT_KEY` should be set in Cursor Secrets. To authenticate:
```bash
echo "$GCP_SERVICE_ACCOUNT_KEY" > /tmp/gcp-key.json
gcloud auth activate-service-account --key-file=/tmp/gcp-key.json
gcloud config set project photogroup-215600
rm /tmp/gcp-key.json
```
GCP project: `photogroup-215600`, zone: `us-central1-a`, VM instance: `main`. Deployment scripts: `deploy-docker.sh`, `deploy-nginx.sh`, `deploy-app.sh`. See `DEPLOYMENT.md` for full details.
