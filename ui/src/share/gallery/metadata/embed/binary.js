// Byte helpers shared by the per-format metadata writers.

/**
 * Read [start, end) of a blob without loading the rest of it. Anything with
 * `size` and `read(start, end)` works too, such as a file still arriving.
 */
export async function readBytes(blob, start, end) {
    if (typeof blob.read === 'function') return blob.read(start, end);
    return new Uint8Array(await blob.slice(start, end).arrayBuffer());
}

/** Latin-1 text, so four-character codes like "©nam" keep their raw byte. */
export function ascii(bytes, start, length) {
    return String.fromCharCode(...bytes.subarray(start, start + length));
}

export function latin1(text) {
    return Uint8Array.from(text, char => char.charCodeAt(0));
}

export function utf8(text) {
    return new TextEncoder().encode(text);
}

export function decodeUtf8(bytes) {
    return new TextDecoder('utf-8').decode(bytes);
}

/** UTF-16 little endian with a byte order mark, as ID3 expects. */
export function utf16(text) {
    const out = new Uint8Array(2 + text.length * 2);
    out.set([0xFF, 0xFE]);
    for (let i = 0; i < text.length; i++) {
        const code = text.charCodeAt(i);
        out[2 + i * 2] = code & 0xFF;
        out[3 + i * 2] = code >> 8;
    }
    return out;
}

/** Big-endian unsigned integer of 0 to 8 bytes. */
export function readUint(bytes, offset, size) {
    let value = 0;
    for (let i = 0; i < size; i++) value = value * 256 + bytes[offset + i];
    return value;
}

export function readUintLE(bytes, offset, size) {
    let value = 0;
    for (let i = size - 1; i >= 0; i--) value = value * 256 + bytes[offset + i];
    return value;
}

export function uint(value, size) {
    const out = new Uint8Array(size);
    for (let i = size - 1; i >= 0; i--) {
        out[i] = value % 256;
        value = Math.floor(value / 256);
    }
    return out;
}

export function uintLE(value, size) {
    return uint(value, size).reverse();
}

export function concat(parts) {
    const out = new Uint8Array(parts.reduce((sum, part) => sum + part.length, 0));
    let offset = 0;
    parts.forEach(part => {
        out.set(part, offset);
        offset += part.length;
    });
    return out;
}

/** Shared rating 1..5 as a 0..1 fraction (1 star = 0), or null when unrated or rejected. */
export function ratingFraction(rating) {
    return rating > 0 ? (rating - 1) / 4 : null;
}
