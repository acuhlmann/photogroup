// Private rooms: one random AES-GCM key per room, carried in the room link
// after "#k=". Browsers never send that part of a link to the server, so the
// server, the tracker and the TURN relay only ever see sealed bytes.
//
// A sealed blob is "PG1" + a 12-byte IV + AES-GCM ciphertext. A sealed file's
// plaintext starts with a 4-byte length and a JSON header (name, type,
// lastModified), so the real file name never leaves the browser in clear.

const MAGIC = [0x50, 0x47, 0x31]; // "PG1"
const IV_BYTES = 12;
const KEY_BYTES = 32;
const SEALED_TEXT = 'sealed:';

function toBase64Url(bytes) {
    let text = '';
    bytes.forEach(byte => { text += String.fromCharCode(byte); });
    return btoa(text).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}

function fromBase64Url(text) {
    const padded = text.replace(/-/g, '+').replace(/_/g, '/') + '==='.slice((text.length + 3) % 4);
    return Uint8Array.from(atob(padded), char => char.charCodeAt(0));
}

/** A new room key, as the text that goes in the link. */
export function newRoomKey() {
    return toBase64Url(crypto.getRandomValues(new Uint8Array(KEY_BYTES)));
}

/** The room key in a link's "#k=…" part, or null. */
export function keyFromHash(hash) {
    const value = new URLSearchParams(String(hash || '').replace(/^#/, '')).get('k');
    return value && /^[A-Za-z0-9_-]{43}$/.test(value) ? value : null;
}

const imported = new Map();

/** The CryptoKey for a key's text. */
export function importRoomKey(text) {
    if (!imported.has(text)) {
        imported.set(text, crypto.subtle.importKey('raw', fromBase64Url(text), { name: 'AES-GCM' }, false, ['encrypt', 'decrypt']));
    }
    return imported.get(text);
}

export async function sealBytes(key, bytes) {
    const iv = crypto.getRandomValues(new Uint8Array(IV_BYTES));
    const sealed = new Uint8Array(await crypto.subtle.encrypt({ name: 'AES-GCM', iv }, key, bytes));
    const out = new Uint8Array(MAGIC.length + IV_BYTES + sealed.length);
    out.set(MAGIC, 0);
    out.set(iv, MAGIC.length);
    out.set(sealed, MAGIC.length + IV_BYTES);
    return out;
}

export async function openBytes(key, bytes) {
    if (MAGIC.some((byte, index) => bytes[index] !== byte)) throw new Error('This file is not from a private room');
    const iv = bytes.subarray(MAGIC.length, MAGIC.length + IV_BYTES);
    const plain = await crypto.subtle.decrypt({ name: 'AES-GCM', iv }, key, bytes.subarray(MAGIC.length + IV_BYTES));
    return new Uint8Array(plain);
}

async function readBytes(blob) {
    return new Uint8Array(await blob.arrayBuffer());
}

/**
 * Seal a file under a neutral name. The name, type and date go inside, so
 * only someone with the key sees them.
 */
export async function sealFile(key, file, sealedName) {
    const header = new TextEncoder().encode(JSON.stringify({
        name: file.name, type: file.type, lastModified: file.lastModified,
    }));
    const body = await readBytes(file);
    const plain = new Uint8Array(4 + header.length + body.length);
    new DataView(plain.buffer).setUint32(0, header.length);
    plain.set(header, 4);
    plain.set(body, 4 + header.length);
    return new File([await sealBytes(key, plain)], sealedName, { type: 'application/octet-stream' });
}

/** The original file inside a sealed one; throws when the key is wrong. */
export async function openFile(key, blob) {
    const plain = await openBytes(key, await readBytes(blob));
    const length = new DataView(plain.buffer, plain.byteOffset).getUint32(0);
    const header = JSON.parse(new TextDecoder().decode(plain.subarray(4, 4 + length)));
    return new File([plain.subarray(4 + length)], header.name || 'photo', {
        type: header.type || '', lastModified: header.lastModified,
    });
}

export function isSealedText(text) {
    return typeof text === 'string' && text.startsWith(SEALED_TEXT);
}

export async function sealText(key, text) {
    return SEALED_TEXT + toBase64Url(await sealBytes(key, new TextEncoder().encode(text)));
}

export async function openText(key, text) {
    return new TextDecoder().decode(await openBytes(key, fromBase64Url(text.slice(SEALED_TEXT.length))));
}
