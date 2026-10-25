# AGENTS.md -- AI Navigation Guide for PhotoGroup

This file helps AI coding agents quickly understand and navigate the PhotoGroup codebase.

## What This Project Is

P2P photo sharing web app. Users create rooms, drop photos, and share them directly browser-to-browser via WebTorrent/WebRTC. Server coordinates room state and magnet links but photos transfer peer-to-peer when possible.

## Key Decisions

- **ES Modules throughout** -- both server and UI use `import/export`, no CommonJS
- **No database** -- rooms live in memory; `server/RoomStore.js` writes the room
  list (ids, photo metadata, magnets, settings) to `server/data/rooms.json` so a
  restart does not empty a room. Peers, connections, photo *owners* and server
  copies are live and are not saved. Photos themselves stay on the peers.
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

Shared photo details (title, description, rating, keywords and location anyone in the room can edit) go through `PUT /api/rooms/:id/photos/details`, validated in `server/PhotoDetails.js` and gated on the caller's session token; the generic `PUT /api/rooms/:id/photos/` ignores `details`. In the UI they live on `tile.details` and override the file's embedded XMP (`groupPhotoMetadata.js`). Saving a photo writes them into the file's own metadata (`gallery/metadata/embed/`: XMP for JPEG/PNG/WebP/HEIC/AVIF, iTunes tags for MP4/MOV/M4A, ID3 for MP3, Vorbis comments for FLAC and Ogg Vorbis/Opus (repaged with fresh CRCs), XMP application extension for GIF, LIST/INFO plus an `id3 ` chunk for WAV, Matroska `Tags` for MKV/WebM: rewritten in place before the first Cluster when Void padding allows, else appended with the SeekHead and Segment size patched); other formats download unchanged. "Download room" in the gallery toolbar (`gallery/saveRoom.js`, `client-zip`) saves every photo that is here in full the same way, one zip for the room, leaving out the ones this person already has (`gallery/alreadyHave.js`): photos shared or saved from this browser, or found in a folder they pick (`gallery/findOnDevice.js`; only files whose size matches a room photo are read). These are matched by a fingerprint each upload carries (`gallery/fingerprint.js`: size plus SHA-256 of the start, middle and end; none for encrypted shares). The fingerprints a browser has are kept in `localStorage`, and tiles say "You shared this", "You saved this" or "On this device". The toolbar menu can still download all. Missing fields are prompted for in the detail panel, and gallery tiles edit the title, description, rating and keywords in place (`metadata/InlineText.js`, `StarPicker`, `KeywordEditor`).

Location comes from EXIF/XMP GPS, HEIC Exif items and video `udta`/`meta` boxes (`metadata/geo.js`, `embed/heif.js`, `embed/mp4.js`) and shows as a map card (`metadata/LocationCard.js`) using OpenStreetMap tiles and Nominatim reverse geocoding (cached, one lookup per second), with Google Maps, Amap and OSM links. GPS fields present but blank (Android zeroes them when a browser picks a photo without location access) become `x-Location status: 'blank'` and show a "Location removed before upload" note instead of NaN rows. Android blanks it on every browser pick, its own Files app included (tested on a phone). Only two routes get originals through: a file manager with all-files access, such as Material Files, picked as an app from ☰ in the picker, or a zip made by one, since Android never blanks a zip. So on Android only (`header/androidUpload.js`), the file input also accepts zips, which `header/unzipMedia.js` unpacks in the browser (stored and deflated entries, Zip64, via `DecompressionStream`). The gallery also shows a dismissible note with those steps (`gallery/AndroidLocationNote.js`). Keep `audio/*` in the input's `accept`, since image/video-only makes Chrome open the photo picker, which can't reach Material Files. Don't open the picker with `showOpenFilePicker` either: in that mode Android's picker lists no apps, so Material Files disappears. Files picked on Android that still show Android's blanking (`metadata/strippedLocation.js`: EXIF GPS latitude/longitude zeroed down to 0/0 denominators, or an MP4 location box with its type wiped) are held back in `Uploader.js` with the same steps, or shared without location if the person asks. Every way of adding files goes through `Uploader.receive`: Share, drops on the gallery, and photos shared from other apps, the last two via the `filesSelected` event. Shares from other apps land in the room used last (`share/shareTarget.js`). People can set or change a location (`metadata/LocationEditor.js`: Nominatim place search, device position, or dragging a `TileMap` under the pin) or hide the file's with `location: null`; saving writes it as XMP `exif:GPS*`, fills JPEG EXIF GPS fields in place when they exist (`embed/exifGps.js`), and as `©xyz` in MP4/MOV.

The gallery toolbar (`gallery/GalleryToolbar.js`) sorts and filters tiles through `gallery/arrangeTiles.js` (rating, date taken, place grouped by town and country, text search over titles, descriptions, keywords and places) and switches to `gallery/RoomMap.js`, which pins every located photo on one map; the viewer pages through the tiles the current view shows.

### Presence and server copies (fallback when P2P fails)

Peers drop their SSE stream whenever a phone switches apps, so presence has
two grace periods (`server/Peers.js`). A stream that closes is gone after
10 s. A tab that goes to the background first sends an `away` beacon
(`POST /api/rooms/:id/peers/:peerId/away`, session token in the query), and
keeps its place and its photo ownership for 10 minutes. On resume,
`torrent/TrackerKick.js` reopens tracker sockets at once instead of waiting
out bittorrent-tracker's reconnect timer (10 s plus up to 5 min of jitter).
It also works around that library's pooled-socket bug, where a tracker that
joins a socket still connecting never announces. `util/ConnectionRecovery.js`
reports hide and resume events.

When P2P and TURN both fail, a temporary server copy is the last tier. It is
pinned **only when needed**:

- **Receiver** (`torrent/ServerFallback.js`): after a 10 s stall it calls
  `POST .../photos/blob/request`.
- **Holder** (`torrent/ServerPinning.js`, any device that has the whole
  photo): it uploads when the photo carries `serverCopyRequestedAt`, or on
  its way into the background if someone present still lacks the photo.
  When the room setting `keepCopies` is on (`PUT /api/rooms/:id/settings`,
  SSE event `room`), it uploads right after sharing.

Uploads are resumable chunks of 8 MB or less:
`PUT .../photos/blob?infoHash&offset&size`, with `X-Session-Id` and
`X-Session-Token` headers. A wrong offset gets 409 with `received`. One
uploader holds a 60 s lease.

`server/PhotoRelay.js` stores copies on disk under `os.tmpdir()`, wiped at
startup. Limits are 100 MB per file, 1 GB per room and 2 GB in total.
Larger files (long clips) still share, P2P only: `ServerPinning` skips them
and tells the sharer to keep the page open. The UI says so
(`CLIP_SIZE_NOTE` in `torrent/ServerCopyLimits.js`).

### Previews and clip posters

Every non-encrypted share carries a `Thumbnail <name>` file per original in
the same torrent (`torrent/ThumbnailExtractor.js`): EXIF or canvas thumbnails
for photos, album art for audio, and for video one frame grabbed in the
sender's browser (`util/videoFrame.js`: hidden `<video>` seeks 0.1 s in,
painted to a canvas, ~5-30 KB JPEG; no server transcoding). Receivers read it
with `gallery/tilePreview.js` (WebTorrent 3 files have `blob()`, not
`getBlobURL`) and show it as the loading preview, the `<video poster>`, the
simple-mode tile and the geek-map thumbnail.

After a refresh, a clip (the image cache holds images only) comes back from
the torrent metadata `TorrentAddition.storeTorrent` keeps in the `torrents`
IndexedDB (parsed with `parse-torrent`; the old `public/parsetorrent.js`
rejects WebTorrent 3's Uint8Array) and its pieces in `indexeddb-chunk-store`.
When those are gone, `ServerFallback` fetches the server copy after the stall
and the gallery plays that file (`fromServerCopy`, no torrent file). jsdom can't decode video, so
`setupTests.js` mocks `util/videoFrame`.

A copy is deleted when any of these happens:

- everyone in the room has the photo (unless `keepCopies` is on);
- 24 h have passed;
- the photo is deleted.

Copy state (`hasServerCopy`, `serverCopyReceived`/`Size`/`Uploader`,
`serverCopyRequestedAt`) is server-managed. The generic photo PUT ignores it,
along with `owners` and `peerId`. `torrent/RoomPhotos.js` mirrors it, with
owners, for the client logic outside React. nginx needs
`client_max_body_size 10m` for the chunks.

### Important: what survives a restart

Room *identity* and *content* are persisted; live presence is not. `Rooms.start()`
calls `restoreRooms()`, which reads ids, photo metadata (incl. `details`), magnet
links and `settings` back from `server/data/rooms.json` (`RoomStore.js`, atomic
write-then-rename, debounced, 30-day idle expiry). `reset()` (DELETE /api/rooms)
clears the file too.

Not persisted, on purpose:

- **peers and connections** -- nobody is connected until they knock again;
- **photo `owners`** -- a peer id from before the restart claims nothing, and
  each device re-declares what it holds on join (`fillMissingOwners`). Restored
  photos get an empty `owners` list, which the owner routes rely on;
- **server copies** (`hasServerCopy` and friends) -- `PhotoRelay` wipes its
  scratch directory at startup, so a restored room must not point at bytes that
  were deleted. Clients re-request a copy if they still need one.

`server/data/` is gitignored: it holds photo names and magnets. `deploy-docker.sh`
and `docker-compose.yml` mount the `photogroup-data` volume at `/app/data`, so the
rooms outlive a redeploy as well as a restart; the `Dockerfile` creates that
directory before `USER nodejs`, because Docker fills an empty named volume from
the image's ownership and a path it has never seen comes back root-owned.

On the client, the mirror rule is in `torrent/TorrentDeletion.js`
(`holdsRoomSnapshot`): a room that lists *no* photos is treated as a server that
has forgotten the room, never as proof that the photos were deleted, so joining a
freshly-restarted server no longer destroys the only copy of a clip on the device
that shared it. Genuine deletions still arrive as a `photos` `type:'delete'`
event. The browser is also asked for durable storage on room open
(`util/PersistentStorage.js`), since it evicts large video pieces first.

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

### Room flow: one way to do each thing, in every mode

- **Room menu** (`header/RoomMenu.js`): the room's name at the top left, in
  every mode. It holds "Name the room", "Privacy" (`RoomPrivacy.js`, a
  controlled dialog) and "Leave the room". Nothing else leaves a room.
- **Invite**: `InviteCode.js` (QR plus "Send the link instead") is the only
  invite UI. Simple shows it in the page (`simple/SimpleRoomBar.js`); default
  and geek open it from the header's Invite button (`header/AddPeersView.js`,
  which also holds the front page's "Scan to join" camera dialog).
- **Add photos**: the header's "Add photos" button (`header/Uploader.js`) in
  default and geek, the big button in simple. The gallery's empty state is a
  drop zone; there is no second strip once photos are there. Drops anywhere
  still work.
- **Room names** are optional and shared: `PUT /api/rooms/:id/settings` takes
  `name` (60 characters at most, '' clears) besides `keepCopies`, and the SSE
  `room` event sends it to everyone. `useRoom.js` puts it in the header and
  the tab title.
- **Keep copies**: the room menu's Privacy dialog (`RoomPrivacy.js`) holds
  the room's "Keep copies for people who join later" switch.
- **Settings** (header, default and geek only) holds only things about this
  browser: your name, colors (`colors.js`: same as device, light or dark,
  localStorage `photogroup.colors`), logs (show, copy) and "Forget this
  device" (`forgetDevice.js`: clears localStorage, sessionStorage and the
  IndexedDB stores, then opens the front page). Room choices do not go here.
- **Going back**: `recentRooms.js` keeps the rooms this browser opened in
  localStorage (`photogroup.rooms`), and `RecentRooms.js` lists them as "Your
  rooms" on both front pages. A deleted room is taken off the list.
- **Private rooms** (opt in: the "Private room" switch under "Start a room"
  on both front pages, `PrivateRoomSwitch.js`, stored as localStorage
  `encrypt`, off by default). A room started with it on gets a random AES-GCM
  key in its link after `#k=` (`privateRoom.js`, `security/roomKey.js`); the
  browser never sends that part to the server. The room's settings get
  `private: true` (one way). Each file is sealed before it is seeded, under a
  neutral name (`photo-<stamp>-<i>`); its real name, type and date are inside.
  Receivers open it in `Gallery.finish` (`gallery/openSealed.js`). The room
  name is sealed too (`sealed:…`). Shared details (titles, ratings, places,
  renames) are off in a private room, since they would reach the server in
  clear. The key is kept in "Your rooms" so the room opens again without it
  in the link; a page without the key gets a notice and cannot add photos.

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
- The only service worker is `ui/public/share-target-sw.js`, registered in `ui/src/index.js`. It receives photos shared from other apps (the manifest's `share_target`) and caches nothing. `src/sw-template.js` and `sw-build.js` are unused Workbox leftovers; don't register another worker at `/`, or it replaces this one
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
Always push to `master`. It is the repository's default branch (`origin/HEAD`);
there is no `main` branch on the remote, though CI accepts either name. Before pushing:
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
