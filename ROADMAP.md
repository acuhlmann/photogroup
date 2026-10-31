# Roadmap

The goal behind every slice: get people the **original** photos and videos
they don't already have, without losing anything (location, metadata) on
the way. Each slice says why it matters, what we already know, where to
start in the code, and when it's done.

- **Up next:** iPhone originals.
- **Later:** recognising saved clips and audio, and helpers for adding a
  location back.

---

# Up next

See **Make iPhone uploads originals** below.

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

## Recognise saved clips and audio in a folder check

Saved photos are recognised now (see Done). Clips and audio saved with
room details are not: MP4, MKV, MP3, FLAC, WAV and Ogg have no XMP here,
so they don't note the original's fingerprint yet.

**Work:** write the fingerprint into each format's own tags (`embed/mp4.js`,
`mkv.js`, `id3.js`, `vorbisComments.js`, `wav.js`) and read it in
`metadata/embed/originalFingerprint.js`.

**Done when:** a clip saved with details in one browser is found by a
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

## Recognise PhotoGroup-saved photos in a folder check

Save writes the room's details into the file, so its bytes and fingerprint
no longer match the original. Now `fileForSave` also writes the original's
fingerprint into the XMP (`pg:OriginalFingerprint`, for JPEG, PNG, WebP,
GIF, HEIF and AVIF). For files whose name matches a room photo (any case,
and "IMG_1 (2).jpg" too), `findOnDevice` reads the note from both ends of
the file (`metadata/embed/originalFingerprint.js`).

## Don't transfer photos people already have

A photo this browser saved, or found on this device, used to download in
full anyway. (Photos shared from here still come back in full, so a
refresh never costs the sharer their own photos.) Now `TorrentAddition._add` adds the torrent
deselected and selects only its `Thumbnail` file, the same way Data saver
does. There is no server fallback for it, and this browser isn't listed as
waiting for it. The tile says "You saved this · preview only" and offers
**Download anyway** (`loadFull`). If a folder check finds a photo that is
still on its way, `stopWhatYouHave` stops it. Tests:
`torrent/__tests__/SkipWhatYouHave.test.js`, `e2e/tests/skip-what-you-have.spec.js`.

## Saving keeps a photo's XMP

When Android blanks a GPS value written as an XMP element, it fills the
bytes with zeros, and the whole packet failed to parse. Saving with room
details then dropped keywords, ratings, edit history and motion-photo
markers. `parsePacket` in `embed/xmpPacket.js` now turns every `\0` into a
space before parsing (`xmpPacket.test.js`).

## No more Replace original

The app no longer writes over a photo on the device. It used to keep the
file handle from a drop or an earlier save, and write back without asking.
That could replace an original that had a location or metadata the room's
copy didn't have. Now each save opens the save dialog
(**Choose where to save…**) or, on iPhone, the share sheet (**Save to
Files**). If someone picks the original file in the dialog, the browser
asks before it replaces it, and the copy is read before the dialog empties
the file (`gallery/replaceOriginal.js`).

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
