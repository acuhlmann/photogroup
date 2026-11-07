/**
 * A small copy of a photo for places that show it small: the rows of the
 * photographer list. A list row drawn from the full photo makes the phone
 * decode 12 megapixels (about 48 MB of pixels) for a 64 px square, and do it
 * again whenever the row is drawn at another size, which is most of what made
 * opening a row slow.
 *
 * The preview that came with the share is used when there is one (a few KB).
 * Without one (an encrypted share, say), a copy is made once with
 * createImageBitmap, which decodes on another thread and can scale while it
 * decodes, two photos at a time, and kept for the session.
 */
import { useEffect, useState } from 'react';
import Logger from 'js-logger';
import { previewUrlOf } from './tilePreview';

const SIDE = 256;
const AT_ONCE = 2;

const made = new Map();
const making = new Map();
const waiting = [];
let running = 0;

const keyOf = tile => tile && (tile.tileKey || tile.infoHash);

function runNext() {
    while (running < AT_ONCE && waiting.length) {
        const job = waiting.shift();
        running += 1;
        job().finally(() => {
            running -= 1;
            runNext();
        });
    }
}

function queued(task) {
    return new Promise((resolve, reject) => {
        waiting.push(() => task().then(resolve, reject));
        runNext();
    });
}

async function shrink(blob) {
    if (typeof createImageBitmap !== 'function' || typeof document === 'undefined') return null;
    let bitmap;
    try {
        bitmap = await createImageBitmap(blob, { resizeHeight: SIDE, resizeQuality: 'medium', imageOrientation: 'from-image' });
    } catch {
        return null;
    }
    try {
        const canvas = document.createElement('canvas');
        canvas.width = bitmap.width;
        canvas.height = bitmap.height;
        canvas.getContext('2d').drawImage(bitmap, 0, 0);
        const small = await new Promise(resolve => canvas.toBlob(resolve, 'image/jpeg', 0.85));
        return small ? URL.createObjectURL(small) : null;
    } finally {
        if (bitmap.close) bitmap.close();
    }
}

/** The small copy if this device already has one, else null. */
export function smallImageOf(tile) {
    if (!tile) return null;
    return previewUrlOf(tile) || made.get(keyOf(tile)) || null;
}

/** The small copy, made from the photo on this device when needed. Resolves to a URL, or null. */
export function loadSmallImage(tile) {
    const ready = smallImageOf(tile);
    if (ready) return Promise.resolve(ready);
    const blob = tile && (tile.elem || tile.file);
    const key = keyOf(tile);
    if (!tile || !tile.isImage || !(blob instanceof Blob) || key == null) return Promise.resolve(null);
    if (!making.has(key)) {
        making.set(key, queued(() => shrink(blob))
            .then(url => {
                if (url) made.set(key, url);
                return url;
            })
            .catch(err => {
                Logger.warn('small copy ' + (tile.fileName || '') + ': ' + (err?.message || err));
                return null;
            })
            .finally(() => making.delete(key)));
    }
    return making.get(key);
}

/**
 * The small copy of a photo for a list row. Until it is here, null. If the
 * browser cannot make one, the full photo (as before), so the row is never
 * left empty.
 */
export function useSmallImage(tile) {
    const ready = smallImageOf(tile);
    const key = keyOf(tile);
    const blob = tile && (tile.elem || tile.file);
    const [found, setFound] = useState({});
    useEffect(() => {
        if (ready || !tile || !tile.isImage) return undefined;
        let live = true;
        loadSmallImage(tile).then(url => {
            if (live) setFound({ key, url: url || tile.img || null });
        });
        return () => { live = false; };
    // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [key, ready, blob]);
    return ready || (found.key === key ? found.url : null);
}
