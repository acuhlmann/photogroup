// On Android a file input offers gallery apps and the photo picker, and
// both hand the browser copies with the location blanked: the browser has
// no permission to read it. Chrome opens showOpenFilePicker() as the system
// Files picker instead, with no app chooser and no photo picker, and Files
// serves the original bytes.

const PICKER_OPTIONS = {
    id: 'photogroup-share',
    multiple: true,
    types: [{
        description: 'Photos, videos and audio',
        accept: {
            'image/*': ['.jpg', '.jpeg', '.png', '.gif', '.webp', '.heic', '.heif', '.avif'],
            'video/*': ['.mp4', '.mov', '.m4v', '.3gp', '.webm', '.mkv'],
            'audio/*': ['.mp3', '.m4a', '.flac', '.wav', '.ogg', '.opus'],
        },
    }],
};

export function onAndroid(nav = typeof navigator !== 'undefined' ? navigator : undefined) {
    if (!nav) return false;
    const platform = nav.userAgentData && nav.userAgentData.platform;
    if (platform) return platform === 'Android';
    return /Android/i.test(nav.userAgent || '');
}

/**
 * True where choosing files should go through the system Files picker.
 * Not in in-app browsers (Android WebView, "wv" in the user agent), which
 * only show pickers their host app implements.
 */
export function usesFilesPicker(win = typeof window !== 'undefined' ? window : undefined) {
    if (!win || !onAndroid(win.navigator) || typeof win.showOpenFilePicker !== 'function') return false;
    return !/;\s*wv\)/.test(win.navigator.userAgent || '');
}

/** Files chosen in the system Files picker; empty when the person backs out. */
export async function pickWithFilesPicker(win = window) {
    let handles;
    try {
        handles = await win.showOpenFilePicker(PICKER_OPTIONS);
    } catch (err) {
        if (err && err.name === 'AbortError') return [];
        throw err;
    }
    return Promise.all(handles.map(handle => handle.getFile()));
}
