// A still frame for a video, so geek mode can show what a clip is instead of a
// grey box. The map paints on a canvas, which needs a frame to draw. Clips
// shared with a poster (see ThumbnailExtractor) use that; otherwise a frame of
// a file this device holds is grabbed (util/videoFrame) and kept as a data URL.

import { captureFrame } from '../util/videoFrame';

const MAX_SIDE = 160;
// Probing the first frames of many clips at once would stall the main thread.
const MAX_AT_ONCE = 2;

// infoHash | tileKey -> 'data:' URL, '' for none, or undefined while probing.
const frames = new Map();
// Object URLs made from a tile's own file, reused so one clip is not read twice.
const urls = new Map();
let probing = 0;

/** The bytes this device holds for a tile, if any. */
function localFile(tile) {
    const file = tile && (tile.elem || tile.file || tile.cachedFile);
    return file instanceof Blob ? file : null;
}

const keyOf = tile => String((tile && (tile.tileKey || tile.infoHash)) || '');

/** A stable object URL for the file a tile holds; '' when there is nothing local. */
export function mediaUrlFor(tile) {
    const key = keyOf(tile);
    if (!key) return '';
    if (urls.has(key)) return urls.get(key);
    const file = localFile(tile);
    if (!file || typeof URL.createObjectURL !== 'function') return '';
    const url = URL.createObjectURL(file);
    urls.set(key, url);
    return url;
}

/**
 * The captured frame for a video tile: a data URL once it is ready, '' when
 * there is no frame to get, undefined while still probing. Calling it starts
 * the capture, so the map can call it every frame and cost nothing until the
 * frame exists.
 */
export function posterFor(tile) {
    if (!tile || !tile.isVideo) return '';
    const key = keyOf(tile);
    if (!key) return '';
    // The sender already grabbed a frame and sent it along with the clip.
    if (tile.previewUrl) return tile.previewUrl;
    if (frames.has(key)) return frames.get(key);
    if (probing >= MAX_AT_ONCE || typeof document === 'undefined') {
        return undefined;
    }
    const src = tile.img || mediaUrlFor(tile);
    if (!src) {
        // Nothing local yet: it will be decoded when the file is here.
        return undefined;
    }
    frames.set(key, undefined);
    probing += 1;
    capture(src).then(url => {
        probing -= 1;
        frames.set(key, url || '');
    });
    return frames.get(key);
}

/** One frame from `src`, cut to a small square-ish thumbnail. */
function capture(src) {
    return captureFrame(src, { maxSide: MAX_SIDE }).then(canvas => {
        if (!canvas) return null;
        try {
            return canvas.toDataURL('image/jpeg', 0.7);
        } catch {
            // A cross-origin or taint failure simply leaves no poster.
            return null;
        }
    });
}

/** Forget what was probed for a tile, so a new clip in its place is read again. */
export function releasePoster(tile) {
    const key = keyOf(tile);
    if (!key) return;
    frames.delete(key);
    const url = urls.get(key);
    if (url) {
        URL.revokeObjectURL(url);
        urls.delete(key);
    }
}

export default { posterFor, mediaUrlFor, releasePoster };
