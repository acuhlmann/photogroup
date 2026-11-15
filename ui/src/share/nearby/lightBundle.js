// More than one photo from screen to camera, small pictures first.
//
// A camera transfer is slow, so the other phone first gets a "sheet": the
// name, size and a small picture of each photo (a few kB each). The person
// there picks the photos that they want, and that phone shows one code with
// the choice (a "pick"). This phone's camera reads it, and then shows the
// picked photos in full, as one stream (a "bundle").
//
// A sheet and a bundle are streams as lightFrames.js carries them: the
// details say which kind, and the file is the parts one after the other.

import { MAX_LIGHT_BYTES } from './lightFrames';

export const MAX_SHEET_ITEMS = 60;
// A small picture on the sheet: its longer side, and its largest size.
export const THUMB_SIDE = 160;
export const MAX_THUMB_BYTES = 12 * 1024;
const PICK_MAGIC = [0x50, 0x4b]; // "PK"
const PICK_VERSION = 1;

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
 * Some photos in full, as one stream.
 * @param {Array<{id: string, name: string, type: string, sealed?: boolean, bytes: Uint8Array, about?: object}>} items
 *   `about` is the photo as the room describes it, for a phone in the same room that does not know it
 */
export function packBundle(items, { room } = {}) {
    return {
        details: {
            kind: 'bundle',
            ...(room === undefined ? {} : { room }),
            items: items.map(item => ({
                id: item.id, name: text(item.name, 200), type: text(item.type, 60), size: item.bytes.length,
                ...(item.sealed ? { sealed: true } : {}), ...(item.about ? { about: item.about } : {}),
            })),
        },
        file: concat(items.map(item => item.bytes)),
    };
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
            ...(room === null ? {} : { room }), ...(item.about && typeof item.about === 'object' ? { about: item.about } : {}),
        },
        file: bytes.slice(),
    }));
}

/** The code that says which photos of a sheet a person wants. */
export function encodePick(sendId, indexes) {
    const picked = [...new Set(indexes)].filter(index => Number.isInteger(index) && index >= 0 && index < MAX_SHEET_ITEMS);
    const out = new Uint8Array(8 + picked.length);
    out[0] = PICK_MAGIC[0];
    out[1] = PICK_MAGIC[1];
    out[2] = PICK_VERSION;
    out[3] = picked.length;
    new DataView(out.buffer).setUint32(4, sendId >>> 0);
    out.set(picked, 8);
    return out;
}

/** `{ sendId, indexes }`, or null when the bytes are not a pick. */
export function decodePick(bytes) {
    if (!bytes || bytes.length < 8 || bytes[0] !== PICK_MAGIC[0] || bytes[1] !== PICK_MAGIC[1] || bytes[2] !== PICK_VERSION) return null;
    const count = bytes[3];
    if (bytes.length !== 8 + count) return null;
    const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
    return { sendId: view.getUint32(4), indexes: [...bytes.subarray(8)].filter(index => index < MAX_SHEET_ITEMS) };
}

/** Whether these photos are small enough for one bundle. */
export function fitsBundle(sizes) {
    return sizes.reduce((sum, size) => sum + size, 0) <= MAX_LIGHT_BYTES;
}

/**
 * A small JPEG of an image for the sheet, or null (not an image, or the
 * browser cannot read it).
 */
export async function makeThumb(blob, side = THUMB_SIDE) {
    if (!blob || typeof createImageBitmap !== 'function' || !/^image\//.test(blob.type || '')) return null;
    let bitmap = null;
    try {
        bitmap = await createImageBitmap(blob);
        const scale = Math.min(1, side / Math.max(bitmap.width, bitmap.height));
        const width = Math.max(1, Math.round(bitmap.width * scale));
        const height = Math.max(1, Math.round(bitmap.height * scale));
        const canvas = document.createElement('canvas');
        canvas.width = width;
        canvas.height = height;
        const pen = canvas.getContext('2d');
        pen.fillStyle = '#fff';
        pen.fillRect(0, 0, width, height);
        pen.drawImage(bitmap, 0, 0, width, height);
        for (const quality of [0.6, 0.4, 0.25]) {
            const jpeg = await new Promise(resolve => canvas.toBlob(resolve, 'image/jpeg', quality));
            if (jpeg && jpeg.size <= MAX_THUMB_BYTES) return new Uint8Array(await jpeg.arrayBuffer());
        }
        return null;
    } catch {
        return null;
    } finally {
        bitmap?.close?.();
    }
}
