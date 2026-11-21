// More than one photo from screen to camera, previews first.
//
// A camera transfer is slow, so the other phone first gets a "sheet": the
// name, size and a small picture of each photo (a few kB each). The person
// there picks the photos that they want and a size (small, the default, or
// full), and that phone shows one code with the choice (a "pick"). This
// phone's camera reads it, and then shows the picked photos as one stream
// (a "bundle"). A photo in small size is a JPEG of up to SMALL_MAX_BYTES:
// at the slow level that is well under a minute, where a full phone photo
// takes a quarter of an hour.
//
// A sheet and a bundle are streams as lightFrames.js carries them: the
// details say which kind, and the file is the parts one after the other.

import { MAX_LIGHT_BYTES } from './lightFrames';
import { captureFrame } from '../util/videoFrame';
export { smallName } from './smallSize';

export const MAX_SHEET_ITEMS = 60;
// A small picture on the sheet: its longer side, and its largest size.
export const THUMB_SIDE = 160;
export const MAX_THUMB_BYTES = 12 * 1024;
// The details of a stream have a length of two bytes (lightFrames.js).
export const MAX_DETAILS_BYTES = 0xffff;
// What the photos of one bundle can be together: the rest is for the details.
export const MAX_BUNDLE_BYTES = MAX_LIGHT_BYTES - MAX_DETAILS_BYTES - 1;
// A photo in small size: it fills a phone screen and is not larger than
// this, so it comes in well under a minute at the slow level. A video in
// small size is one photo from it. The sizes are tried in turn until the
// JPEG fits.
export const SMALL_MAX_BYTES = 100 * 1000;
const SMALL_SIDES = [1280, 1024, 800, 640];
const PICK_MAGIC = [0x50, 0x4b]; // "PK"
// 1: the photos in full size. 2: one more byte says the size.
const PICK_VERSION = 2;
const PICK_SMALL = 1;

function concat(parts) {
    const out = new Uint8Array(parts.reduce((sum, part) => sum + part.length, 0));
    let at = 0;
    parts.forEach((part) => {
        out.set(part, at);
        at += part.length;
    });
    return out;
}

const text = (value, max) => String(value || '').slice(0, max);

/**
 * The sheet of some photos.
 * @param {Array<{id: string, name: string, type: string, size: number, sealed?: boolean, thumb?: Uint8Array|null}>} items
 * @param {{room?: number}} [options] the tag of the sender's room, when it is in one
 * @returns {{details: object, file: Uint8Array}}
 */
export function packSheet(items, { room } = {}) {
    const listed = items.slice(0, MAX_SHEET_ITEMS);
    const thumbs = listed.map(item => (item.thumb && item.thumb.length <= MAX_THUMB_BYTES ? item.thumb : new Uint8Array(0)));
    return {
        details: {
            kind: 'sheet',
            ...(room === undefined ? {} : { room }),
            items: listed.map((item, index) => ({
                id: item.id, name: text(item.name, 80), type: text(item.type, 60), size: item.size,
                ...(item.sealed ? { sealed: true } : {}), thumb: thumbs[index].length,
            })),
        },
        // A stream has one byte at least.
        file: concat([...thumbs, new Uint8Array(1)]),
    };
}

function checkedItems(details, sizeOf, file) {
    if (!Array.isArray(details?.items) || !details.items.length || details.items.length > MAX_SHEET_ITEMS) return null;
    let at = 0;
    const items = [];
    for (const item of details.items) {
        const length = sizeOf(item);
        if (!item || typeof item.id !== 'string' || !Number.isInteger(length) || length < 0 || at + length > file.length) return null;
        items.push({ item, bytes: file.subarray(at, at + length) });
        at += length;
    }
    return items;
}

/** The photos of a sheet, each with its small picture (or null), or null when this is not a sheet. */
export function readSheet(result) {
    if (result?.details?.kind !== 'sheet') return null;
    const items = checkedItems(result.details, item => item?.thumb, result.file);
    if (!items) return null;
    return {
        room: Number.isInteger(result.details.room) ? result.details.room : null,
        items: items.map(({ item, bytes }) => ({
            id: item.id, name: text(item.name, 80), type: text(item.type, 60),
            size: Number.isFinite(item.size) && item.size >= 0 ? item.size : 0,
            sealed: !!item.sealed, thumb: bytes.length ? bytes : null,
        })),
    };
}

/**
 * Some photos, as one stream.
 * @param {Array<{id: string, name: string, type: string, sealed?: boolean, small?: boolean, bytes: Uint8Array, about?: object}>} items
 *   `about` is the photo as the room describes it, for a phone in the same room that does not know it;
 *   `small` says that the bytes are a JPEG in small size, not the photo itself (`type` stays the photo's)
 */
export function packBundle(items, { room } = {}) {
    const listed = items.map(item => ({
        id: item.id, name: text(item.name, 200), type: text(item.type, 60), size: item.bytes.length,
        ...(item.sealed ? { sealed: true } : {}), ...(item.small ? { small: true } : {}), ...(item.about ? { about: item.about } : {}),
    }));
    const details = { kind: 'bundle', ...(room === undefined ? {} : { room }), items: listed };
    // The photos are what matters. When the descriptions make the details
    // too long, the longest descriptions stay out: such a photo is saved on
    // the other phone, and does not join its room.
    const length = value => new TextEncoder().encode(JSON.stringify(value)).length;
    while (length(details) > MAX_DETAILS_BYTES) {
        const longest = listed.filter(item => item.about).sort((a, b) => length(b.about) - length(a.about))[0];
        if (!longest) throw new RangeError('The details of the photos are too long for one transfer');
        delete longest.about;
    }
    return { details, file: concat(items.map(item => item.bytes)) };
}

/** The photos of a bundle: `[{ details, file }]`, or null when this is not a bundle. */
export function readBundle(result) {
    if (result?.details?.kind !== 'bundle') return null;
    const items = checkedItems(result.details, item => item?.size, result.file);
    if (!items) return null;
    const room = Number.isInteger(result.details.room) ? result.details.room : null;
    return items.map(({ item, bytes }) => ({
        details: {
            id: item.id, name: text(item.name, 200), type: text(item.type, 60), sealed: !!item.sealed,
            ...(item.small ? { small: true } : {}), ...(room === null ? {} : { room }), ...(item.about && typeof item.about === 'object' ? { about: item.about } : {}),
        },
        file: bytes.slice(),
    }));
}

/**
 * The code that says which photos of a sheet a person wants, and in which
 * size: `small` (the default) or full size.
 */
export function encodePick(sendId, indexes, { small = true } = {}) {
    const picked = [...new Set(indexes)].filter(index => Number.isInteger(index) && index >= 0 && index < MAX_SHEET_ITEMS);
    const out = new Uint8Array(9 + picked.length);
    out[0] = PICK_MAGIC[0];
    out[1] = PICK_MAGIC[1];
    out[2] = PICK_VERSION;
    out[3] = picked.length;
    new DataView(out.buffer).setUint32(4, sendId >>> 0);
    out[8] = small ? PICK_SMALL : 0;
    out.set(picked, 9);
    return out;
}

/** `{ sendId, indexes, small }`, or null when the bytes are not a pick. */
export function decodePick(bytes) {
    if (!bytes || bytes.length < 8 || bytes[0] !== PICK_MAGIC[0] || bytes[1] !== PICK_MAGIC[1]) return null;
    // A phone with the app from before the size choice asks in full size.
    const version = bytes[2];
    if (version !== 1 && version !== 2) return null;
    const start = version === 1 ? 8 : 9;
    const count = bytes[3];
    if (bytes.length !== start + count) return null;
    const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
    return {
        sendId: view.getUint32(4),
        indexes: [...bytes.subarray(start)].filter(index => index < MAX_SHEET_ITEMS),
        small: version === 2 && (bytes[8] & PICK_SMALL) === PICK_SMALL,
    };
}

/** Whether these photos are small enough for one bundle, with room for their details. */
export function fitsBundle(sizes) {
    return sizes.reduce((sum, size) => sum + size, 0) <= MAX_BUNDLE_BYTES;
}

/** Whether a photo can go in small size: an image or a video that is not private. */
export function canBeSmall(item) {
    return !item.sealed && /^(image|video)\//.test(item.type || '');
}

/**
 * About how many bytes a photo is in a size. A photo in small size is never
 * larger than SMALL_MAX_BYTES; one that is smaller than that already, or
 * that cannot be small, goes as it is.
 */
export function bytesInSize(item, small) {
    return small && canBeSmall(item) ? Math.min(item.size, SMALL_MAX_BYTES) : item.size;
}

/** A picture of an image or video file that can be drawn, with its width and height, or null. */
async function pictureOf(blob, side) {
    if (!blob) return null;
    if (/^image\//.test(blob.type || '') && typeof createImageBitmap === 'function') {
        try {
            const bitmap = await createImageBitmap(blob);
            return { source: bitmap, width: bitmap.width, height: bitmap.height, close: () => bitmap.close?.() };
        } catch {
            return null;
        }
    }
    if (/^video\//.test(blob.type || '') && typeof URL.createObjectURL === 'function') {
        const url = URL.createObjectURL(blob);
        try {
            const canvas = await captureFrame(url, { maxSide: side });
            return canvas ? { source: canvas, width: canvas.width, height: canvas.height, close: () => {} } : null;
        } finally {
            URL.revokeObjectURL(url);
        }
    }
    return null;
}

/**
 * A JPEG of an image, or of one frame of a video, that is not larger than
 * `maxBytes`: each side in `sides` is tried, largest first, at each quality.
 * Null when the browser cannot read the file, or no JPEG fits.
 */
export async function shrinkToJpeg(blob, { sides, maxBytes, qualities = [0.7, 0.55, 0.4] }) {
    if (typeof document === 'undefined') return null;
    const picture = await pictureOf(blob, sides[0]);
    if (!picture) return null;
    try {
        for (const side of sides) {
            const scale = Math.min(1, side / Math.max(picture.width, picture.height));
            const width = Math.max(1, Math.round(picture.width * scale));
            const height = Math.max(1, Math.round(picture.height * scale));
            const canvas = document.createElement('canvas');
            canvas.width = width;
            canvas.height = height;
            const pen = canvas.getContext('2d');
            pen.fillStyle = '#fff';
            pen.fillRect(0, 0, width, height);
            pen.drawImage(picture.source, 0, 0, width, height);
            for (const quality of qualities) {
                const jpeg = await new Promise(resolve => canvas.toBlob(resolve, 'image/jpeg', quality));
                if (jpeg && jpeg.size <= maxBytes) return new Uint8Array(await jpeg.arrayBuffer());
            }
        }
        return null;
    } catch {
        return null;
    } finally {
        picture.close();
    }
}

/**
 * A small JPEG of an image or a video for the sheet (the preview), or null
 * (not an image or video, or the browser cannot read it).
 */
export function makeThumb(blob, side = THUMB_SIDE) {
    return shrinkToJpeg(blob, { sides: [side], maxBytes: MAX_THUMB_BYTES, qualities: [0.6, 0.4, 0.25] });
}

/**
 * A photo in small size: a JPEG that fills a phone screen and is not larger
 * than SMALL_MAX_BYTES. For a video, one photo from it. Null when the
 * browser cannot read the file.
 */
export function makeSmall(blob) {
    return shrinkToJpeg(blob, { sides: SMALL_SIDES, maxBytes: SMALL_MAX_BYTES });
}

