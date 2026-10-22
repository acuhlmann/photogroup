# Roadmap

The goal behind every slice: get people the **original** photos and videos
they don't already have, without losing anything (location, metadata) on
the way. Each slice says why it matters, what we already know, where to
start in the code, and when it's done.

- **Up next** (tomorrow): fix the XMP wipe on save, then make Replace
  original safe or remove it.
- **Later:** iPhone originals, skipping the transfer of photos people
  have, recognising saved copies, and helpers for adding a location back.

---

# Up next

## Stop saving from wiping a photo's XMP

**Why:** a data-loss bug on every Save, not just Replace. When Android
blanks a GPS value written as an XML *element* in a photo's XMP (ExifTool
writes them that way; Adobe apps and our own writer use attributes), it
fills those bytes with zeros. Zero bytes make the XMP unparseable, so
`parsePacket` in `ui/src/share/gallery/metadata/embed/xmpPacket.js` swaps
in an empty packet, and saving with room details drops everything else in
the XMP: keywords, ratings, edit history, Google motion-photo markers.

**What we know:** confirmed in headless Chromium. Parsing the zeroed XMP
gives a `parsererror`; replacing `\0` with spaces first parses cleanly and
keeps the other fields.

**Change:** in `parsePacket`, replace every `\0` with a space before
parsing (today only trailing zeros are stripped).

**Done when:** a test with element-form XMP whose GPS element is zeroed
keeps its other fields after `applyDetailsToXmp`.

---

## Make Replace original safe, or remove it

**Why:** writing an edited photo back over the original on the device is
hard to do safely. It can overwrite a file whose location was blanked
before upload, or one that has metadata the room never saw.

**Options:**

- Remove Replace original and keep plain Save, or
- Allow it only when the file is unchanged apart from the room's details and
  nothing was blanked. `strippedLocation.js` already detects blanking for
  JPEG, HEIC and MP4.

**Also known:** `showSaveFilePicker` empties the chosen file as soon as the
dialog is confirmed (see `replaceOriginal.js`), and Chrome writes through a `.crswap` swap
file, which can drop file-system extras such as macOS tags and creation dates.

**Done when:** the decision is made and the code matches it.

---

# Later

## Make iPhone uploads originals

**Why:** the iPhone counterpart of the Android fix. Depending on the iOS
version and the `accept` attribute, Safari may convert library HEIC photos
to JPEG, compress videos, and drop location before the page sees them. Then
iPhone users share copies, not originals, which undercuts the app's main
purpose.

**What we know (reports, not yet verified):**

- Safari's file input can transcode HEIC → JPEG; listing `image/heic` in
  `accept` changes this behaviour on some versions.
- Some iOS versions strip GPS from library picks (reported around 16.4).
- Picking through the Files app instead of Photos may give the original.

**Work:**

1. Test on an iPhone which pick routes (Photos vs. Files) and which `accept`
   values deliver the original bytes, HEIC and video untouched, location kept.
2. Steer Share towards that route on iOS, the way the Android note and zip route do.
3. Detect converted or stripped files after picking (a JPEG where the name
   says `.HEIC`, missing GPS on a camera photo) and hold them back like
   `strippedLocation.js` does.

**Done when:** a photo shared from an iPhone arrives byte-identical to the
one in its Photos library, or the app explains why it couldn't.

---

## Don't transfer photos people already have

**Why:** today, photos someone already has still download over P2P so the
gallery can show them; only saving skips them. On mobile data or with big
videos, that's wasted transfer.

**What we know:** WebTorrent 3 can add a torrent with nothing selected
(`deselect: true`) and select single files. Every photo torrent also
carries a small `Thumbnail <name>` file. Peers add every room torrent in
`TorrentAddition.handlePhotoAddEvent` / `_add`, and `ServerFallback.watch`
asks for (and fetches) a server copy when P2P stalls.

**Work:**

- For photos `alreadyHave()` knows, add the torrent deselected and select
  only the thumbnail; don't start the server fallback for them.
- Show those tiles from the thumbnail, with **Download anyway**.
- When a folder check finds a photo, stop its transfer if it's still arriving.
- Careful: the tile rendering pipeline (`Gallery.js`, `RenderContent.js`,
  `LoadingTile.js`) assumes the main file arrives; it needs a
  "thumbnail only, by choice" state.

**Done when:** in a two-browser test, a photo the receiver already has
transfers only its thumbnail, and Download anyway still gets the original.

---

## Recognise PhotoGroup-saved copies in a folder check

**Why:** Save writes the room's details into the file, so its bytes (and
fingerprint) no longer match the original. A later *Find the ones on this
device…* won't recognise photos saved from PhotoGroup. This browser's own
record still does, but another browser or device won't.

**Work:**

- When saving, write the original's fingerprint into the file's metadata
  (an XMP property, plus the formats `embed/` already writes for video and audio).
- Folder checks can't pre-filter these by size, because sizes differ. Read the
  metadata only of files whose name or date taken matches a room photo, and
  compare the stored fingerprint.

**Done when:** a photo saved with details in one browser is found by a
folder check in another.

---

## Helpers for adding a location back

For photos whose location was removed before they reached the app:

- **From a nearby photo:** Android only blanks GPS; date taken survives.
  Offer "Use the location of IMG_x, taken 4 minutes apart" from other
  located photos in the room, also as a batch action.
- **Paste coordinates or a map link:** Google Photos still shows the
  location. Parse `47.37, 8.54` and Google Maps `@lat,long` links in
  `metadata/LocationEditor.js`.
- **Current position at share time:** for photos taken in the last half
  hour, offer the device's position (`LocationEditor` already has it).

**Done when:** each of the three paths sets a location on a blanked photo
in one or two taps.

**Not now:** parked until the slices above are done.

---

# Done

## Stay a peer when switching apps; server copies only when needed

Switching to another app used to drop a phone from the room within 10 s.
It then took up to 5 minutes to find peers again, because of
bittorrent-tracker's reconnect jitter. The server-copy fallback uploaded
every photo, but nginx's 1 MB body limit turned real photos away. Now:

- **Away, not gone.** Going to the background sends an away beacon, and
  the room keeps the phone and its photos for 10 minutes.
- **Back at once.** On resume, `TrackerKick` reopens tracker sockets
  immediately, including ones that only look open after a long sleep. It
  also refreshes TURN credentials and re-syncs the room.
- **Server copies only when needed.** A stalled receiver asks for one,
  and someone who has the photo uploads it. A phone going to the
  background also uploads photos someone present still lacks. The copy
  is deleted once everyone has the photo, or after 24 h.
- **Keep Copies for Latecomers** (Settings, per room) keeps every photo
  for 24 h.
- Copies are written to disk in resumable 8 MB chunks, up to 100 MB per
  file.

**Still to check on real phones** (can't be automated):

- [ ] Two phones on different networks (Wi-Fi and cellular). Share, then
  switch the sharer to another app for a minute: the receiver gets the
  photo, from the server copy if P2P can't connect.
- [ ] Come back to the app after 5+ minutes: you're listed again (no
  "away") within seconds, and new photos arrive over P2P.
- [ ] Share a 50 MB video, then lock the phone midway through the server
  copy. After unlocking, the upload carries on, and the receiver gets the
  video.

## Android uploads that keep locations

**Shipped:** PR #129, then straight to `master`.

Android blanks the location on every browser pick. Tested on a phone: its
own Files app, picked from DCIM › Camera, blanks it too. Two routes get
originals through:

- **Material Files**, picked as an app from ☰ in the picker. It has
  all-files access, so it reads the originals.
- **A zip**, made by a file manager. Android never blanks a zip, and the
  app unpacks it in the browser (`header/unzipMedia.js`).

Zips are accepted on Android only. A dismissible note in the gallery
explains both routes (`gallery/AndroidLocationNote.js`). Photos that still
arrive blanked are held back with the same steps
(`gallery/metadata/strippedLocation.js`, `header/Uploader.js`). An earlier
attempt opened `showOpenFilePicker` instead. It kept nothing and hid
Material Files, since Android's picker lists no apps in that mode.

## Only download what you don't have

Uploads carry a fingerprint. Download room leaves out photos shared or saved
from this browser, or found in a folder the person picks. Files:
`gallery/fingerprint.js`, `alreadyHave.js`, `findOnDevice.js`,
`DownloadRoomButton.js`.

## Share into PhotoGroup from other apps, and drops

The share target used to drop every file. Its service worker was never
built or registered, nothing listened for the files, and the room was lost
on the way. Now:

- **Receiving:** `public/share-target-sw.js` catches the share and keeps the
  files as blobs in IndexedDB. It is the only service worker, and it caches
  nothing.
- **Landing in a room:** the app opens the room used last
  (`share/shareTarget.js`), or waits until one is opened.
- **Adding:** files go in through `filesSelected`, the same entry point
  Share and gallery drops now use (`header/Uploader.js`). On Android that
  means zips are unpacked and blanked photos held back. With encryption on,
  drops are encrypted now too.
- **Before the worker runs:** a share that reaches the server instead is
  redirected with a message to share again.

The manifest now also accepts audio and zips. An installed app can take a
while to pick up the new share types; reinstalling picks them up at once.

**Still to check on a real Android phone** (can't be automated):

- [x] Pick from internal storage › DCIM › Camera in Files: location still removed.
- [ ] Share → ☰ → Material Files → DCIM › Camera: does the map card show the location?
- [ ] Zip a few photos and a video in a file manager, share the zip: do the photos arrive with their location?
- [ ] With PhotoGroup installed: in Material Files, select photos → Share → PhotoGroup. Do they land in the last room with their location?
- [ ] Download room ⋮ → *Find the ones on this device…* → pick DCIM › Camera: are your own photos found?
