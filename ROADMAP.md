# Roadmap

Next slices, most valuable first. The goal behind all of them: get people
the **original** photos and videos they don't already have, without
losing anything (location, metadata) on the way.

Each slice says why it matters, what we already know, where to start in
the code, and when it's done.

---

## 1. Ship the Android picker and "already have" downloads

**Status:** built, uncommitted on branch `keep-android-locations`.

Two features, to go in as separate commits:

- **Android Files picker** — Share on Android opens the system Files picker
  (`showOpenFilePicker`) instead of the file input's app chooser, whose
  gallery apps and photo picker hand over copies with the location blanked.
  Picked files that still show Android's blanking are held back with
  directions. Files: `ui/src/share/header/pickFiles.js`, `Uploader.js`,
  `gallery/metadata/strippedLocation.js`.
- **Only download what you don't have** — uploads carry a fingerprint;
  Download room leaves out photos shared or saved from this browser, or
  found in a folder the person picks. Files: `gallery/fingerprint.js`,
  `alreadyHave.js`, `findOnDevice.js`, `DownloadRoomButton.js`.

**Still to check on a real Android phone** (can't be automated):

- [ ] Share → pick a geotagged photo from *Recent* in Files: does the map card show its location?
- [ ] Same, picked from *internal storage › DCIM › Camera*.
- [ ] Download room ⋮ → *Find the ones on this device…* → pick DCIM › Camera: are your own photos found?

The claim that Files keeps location comes from Android's source
(MediaProvider only blanks for the photo picker and for apps reading
MediaStore without `ACCESS_MEDIA_LOCATION`; Files' storage providers are
exempt) and from third-party reports, not from a device test. If a Files
section still blanks on some phone, the hold-back dialog catches it.

**Done when:** committed, PR merged, phone checks above pass (or findings
are written back here).

---

## 2. Stop saving from wiping a photo's XMP

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

## 3. Make iPhone uploads originals

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
2. Steer Share towards that route on iOS, the way `pickFiles.js` does on Android.
3. Detect converted or stripped files after picking (a JPEG where the name
   says `.HEIC`, missing GPS on a camera photo) and hold them back like
   `strippedLocation.js` does.

**Done when:** a photo shared from an iPhone arrives byte-identical to the
one in its Photos library, or the app explains why it couldn't.

---

## 4. Don't transfer photos people already have

**Why:** today, photos someone already has still download over P2P so the
gallery can show them; only saving skips them. On mobile data or with big
videos, that's wasted transfer.

**What we know:** WebTorrent 3 can add a torrent with nothing selected
(`deselect: true`) and select single files. Every photo torrent also
carries a small `Thumbnail <name>` file. Peers add every room torrent in
`TorrentAddition.handlePhotoAddEvent` / `_add`, and `ServerFallback.watch`
can fetch the full file from the server when P2P stalls.

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

## 5. Recognise PhotoGroup-saved copies in a folder check

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

## 6. Decide on Replace original

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

## 7. Helpers for adding a location back

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

---

## 8. Close the drag-and-drop gap on Android

**Why:** files dropped into the gallery (`Gallery.js` `handleDrop`) go
straight to seeding and skip the Android blanking check that Share runs.
It only matters for split-screen drag on Android.

**Change:** route drops through the same check as `Uploader.receive`.

**Done when:** a blanked file dropped on Android is held back like one picked
through Share.
