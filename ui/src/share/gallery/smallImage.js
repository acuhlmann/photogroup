/**
 * A small copy of a photo for places that show it small: the rows of the
 * photographer list (256 px) and the squares of the simple grid (640 px). A list row drawn from the full photo makes the phone
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

// Formats that can be see-through: their copy keeps that (a JPEG would turn it black).
const SEE_THROUGH = /^image\/(png|webp|gif|avif|apng)$/;
// A panorama's copy is at most this many times as long as it is high.
const LONGEST = 4;

/** The photo's width and height, read from the file's header (the pixels are not decoded). */
function sizeOf(blob) {
    if (typeof Image !== 'function' || typeof URL.createObjectURL !== 'function') return Promise.resolve(null);
    return new Promise(resolve => {
        const url = URL.createObjectURL(blob);
        const img = new Image();
        // The size is known once the file has loaded; the pixels are only
        // decoded when drawn, which this image never is.
        const done = size => {
            clearTimeout(timer);
            img.onload = img.onerror = null;
            URL.revokeObjectURL(url);
            resolve(size);
        };
        const timer = setTimeout(() => done(null), 3000);
        img.onload = () => done(img.naturalWidth > 0 ? { width: img.naturalWidth, height: img.naturalHeight } : null);
        img.onerror = () => done(null);
        img.src = url;
    });
}

/**
 * How to scale while decoding: the short side to `side`, but a panorama's
 * long side to at most LONGEST times that. One side only, so the shape stays.
 * Nothing when the photo is that small already.
 */
export function copySize(size, side) {
    const { width, height } = size;
    const wide = width >= height;
    const long = Math.max(width, height);
    const short = Math.min(width, height);
    const panorama = long > short * LONGEST;
    const target = panorama ? side * LONGEST : side;
    const now = panorama === wide ? width : height;
    if (target >= now) return {};
    return panorama === wide ? { resizeWidth: target } : { resizeHeight: target };
}

async function shrink(tile, blob, side) {
    if (typeof createImageBitmap !== 'function' || typeof document === 'undefined') return null;
    const size = await sizeOf(blob);
    // Without the size a panorama could make a huge bitmap: no copy, the full photo shows.
    if (!size) return null;
    let bitmap;
    try {
        bitmap = await createImageBitmap(blob, { ...copySize(size, side), resizeQuality: 'medium', imageOrientation: 'from-image' });
    } catch {
        return null;
    }
    try {
        const canvas = document.createElement('canvas');
        canvas.width = bitmap.width;
        canvas.height = bitmap.height;
        canvas.getContext('2d').drawImage(bitmap, 0, 0);
        // A browser that cannot write WebP writes PNG, which keeps it see-through too.
        const type = SEE_THROUGH.test(blob.type || tile.fileType || '') ? 'image/webp' : 'image/jpeg';
        const small = await new Promise(resolve => canvas.toBlob(resolve, type, 0.85));
        return small ? URL.createObjectURL(small) : null;
    } finally {
        if (bitmap.close) bitmap.close();
    }
}

// The preview that comes with a share is about 200 px: good for a list row, too soft for a grid tile.
const madeKey = (tile, side) => keyOf(tile) + '@' + side;

/** The small copy if this device already has one, else null. */
export function smallImageOf(tile, side = SIDE) {
    if (!tile) return null;
    return (side <= SIDE && previewUrlOf(tile)) || made.get(madeKey(tile, side)) || null;
}

/** The small copy, made from the photo on this device when needed. Resolves to a URL, or null. */
export function loadSmallImage(tile, side = SIDE) {
    const ready = smallImageOf(tile, side);
    if (ready) return Promise.resolve(ready);
    const blob = tile && (tile.elem || tile.file);
    if (!tile || !tile.isImage || !(blob instanceof Blob) || keyOf(tile) == null) return Promise.resolve(null);
    const key = madeKey(tile, side);
    if (!making.has(key)) {
        making.set(key, queued(() => shrink(tile, blob, side))
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
export function useSmallImage(tile, side = SIDE) {
    const ready = smallImageOf(tile, side);
    const key = keyOf(tile) + '@' + side;
    const blob = tile && (tile.elem || tile.file);
    const [found, setFound] = useState({});
    useEffect(() => {
        if (ready || !tile || !tile.isImage || !(blob instanceof Blob) || typeof createImageBitmap !== 'function') return undefined;
        let live = true;
        loadSmallImage(tile, side).then(url => {
            if (live) setFound({ key, url: url || tile.img || null });
        });
        return () => { live = false; };
    // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [key, ready, blob]);
    if (ready) return ready;
    if (found.key === key) return found.url;
    // Nothing to make a copy from, or no way to: the full photo, at once.
    const cannot = tile && (!tile.isImage || !(blob instanceof Blob) || typeof createImageBitmap !== 'function');
    return cannot ? tile.img || null : null;
}
