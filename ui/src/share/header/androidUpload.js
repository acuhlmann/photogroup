// Android blanks the location in photos and videos it hands to a browser,
// whichever picker is used: the photo picker, gallery apps and its own Files
// app alike. Two ways get originals through: picking with a file manager
// that has access to all files (Material Files), or a zip made by one,
// since Android never blanks a zip.

export const MATERIAL_FILES_URL = 'https://play.google.com/store/apps/details?id=me.zhanghai.android.files';

/** What the file input offers. Zips only on Android, the one place they help. */
export const ACCEPT = 'image/*,video/*,audio/*';
export const ANDROID_ACCEPT = ACCEPT + ',.zip,application/zip';

/** How to share with the location kept, for the note and the hold-back dialog. */
export const KEEP_LOCATION_STEPS = 'In the picker, open ☰ and select Material Files. (First, let it manage all files.) '
    + 'Then go to DCIM › Camera. Or make a zip of the photos in your file manager and share the zip.';

export function onAndroid(nav = typeof navigator !== 'undefined' ? navigator : undefined) {
    if (!nav) return false;
    const platform = nav.userAgentData && nav.userAgentData.platform;
    if (platform) return platform === 'Android';
    return /Android/i.test(nav.userAgent || '');
}
