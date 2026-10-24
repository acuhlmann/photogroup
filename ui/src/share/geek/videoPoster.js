// A still frame for a video, so geek mode can show what a clip is instead of a
// grey box. The gallery plays video from a DOM <video> element; the map paints
// on a canvas, which needs a frame to draw. So we ask the browser for one: a
// hidden video element seeks a little into the clip and the frame is painted
// into a canvas, kept as a data URL.
//
// Only a file this device actually holds is decoded, and never the whole clip:
// reading a large video into memory is what used to freeze the tab, so the
// element seeks to a fraction of a second and stops there.

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
    if (!file) return '';
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
    if (frames.has(key)) return frames.get(key);
    if (probing >= MAX_AT_ONCE || typeof document === 'undefined' || typeof window?.Video !== 'function') {
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
    return new Promise(resolve => {
        const video = document.createElement('video');
        let settled = false;
        const done = value => {
            if (settled) return;
            settled = true;
            video.removeAttribute('src');
            video.load();
            resolve(value);
        };
        const timer = setTimeout(() => done(null), 8000);
        video.muted = true;
        video.playsInline = true;
        video.preload = 'metadata';
        video.onerror = () => { clearTimeout(timer); done(null); };
        video.addEventListener('error', () => { clearTimeout(timer); done(null); });
        video.addEventListener('loadeddata', () => {
            // A frame is only decodable once the element has seeked into the clip.
            const seconds = Math.min(0.1, (video.duration || 1) / 4);
            if (video.readyState < 2 || !Number.isFinite(video.duration)) { clearTimeout(timer); done(null); return; }
            video.addEventListener('seeked', paint, { once: true });
            try {
                video.currentTime = seconds;
            } catch {
                clearTimeout(timer);
                done(null);
            }
        });
        function paint() {
            clearTimeout(timer);
            if (!video.videoWidth || !video.videoHeight) return done(null);
            const scale = Math.min(MAX_SIDE / video.videoWidth, MAX_SIDE / video.videoHeight, 1);
            const canvas = document.createElement('canvas');
            canvas.width = Math.max(1, Math.round(video.videoWidth * scale));
            canvas.height = Math.max(1, Math.round(video.videoHeight * scale));
            const ctx = canvas.getContext('2d');
            if (!ctx) return done(null);
            ctx.drawImage(video, 0, 0, canvas.width, canvas.height);
            try {
                done(canvas.toDataURL('image/jpeg', 0.7));
            } catch {
                // A cross-origin or taint failure simply leaves no poster.
                done(null);
            }
        }
        video.src = src;
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
