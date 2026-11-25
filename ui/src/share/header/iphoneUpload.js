// Safari on iPhone and iPad picks from the Photos library through a picker
// that can hand the page copies instead of originals:
//
// - Format: since WebKit 0f76043f (March 2024) Safari keeps HEIC as it is
//   when `accept` allows every image type, as ACCEPT's image/* does. A
//   list of single types (image/jpeg, …) makes it convert to JPEG, and
//   listing image/heic makes Safari 17 turn JPEG and PNG into HEIC. So
//   never narrow image/* and never add image/heic.
// - Location: removed since iOS 16.4 unless the person turns on Location
//   under Options in the photo picker (iOS 17 and later).
// - Clips: Safari still makes them smaller (H.264). Only a pick from Files
//   ("Choose File") gives the original clip.

/** How to keep the location, for the note and the hold-back dialog. */
export const IPHONE_LOCATION_STEPS = 'In the photo picker, tap Options and turn on Location.';

/** How to share original clips, for the note. */
export const IPHONE_CLIP_STEPS = 'The iPhone makes clips from the photo library smaller. '
    + 'To share the original clips, first save them to Files: in Photos, tap Share, then Save to Files. '
    + 'Then add them here and select Choose File.';

/** True on an iPhone, iPod or iPad, including iPads that say they are a Mac. */
export function onIPhone(nav = typeof navigator !== 'undefined' ? navigator : undefined) {
    if (!nav) return false;
    if (/iPhone|iPad|iPod/i.test(nav.userAgent || '')) return true;
    return /Macintosh/i.test(nav.userAgent || '') && (nav.maxTouchPoints || 0) > 1;
}
