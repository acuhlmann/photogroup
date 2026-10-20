// A photo's identity, independent of its name, cheap enough to take for
// every file a person shares or points us at: its size, plus a SHA-256 of
// its start, middle and end. Originals travel byte for byte, so the same
// photo has the same fingerprint wherever it is; a recompressed or edited
// copy does not.

const SAMPLE = 256 * 1024;

const hex = buffer => Array.from(new Uint8Array(buffer), byte => byte.toString(16).padStart(2, '0')).join('');

/** "<size>:<sha256>", or null when the file can't be read or WebCrypto is missing (plain http). */
export async function fingerprintFile(file) {
    const subtle = globalThis.crypto && globalThis.crypto.subtle;
    if (!subtle || !file || typeof file.size !== 'number' || typeof file.slice !== 'function') return null;
    try {
        const size = file.size;
        const middle = Math.floor(size / 2 - SAMPLE / 2);
        const parts = size <= SAMPLE * 3
            ? [file]
            : [file.slice(0, SAMPLE), file.slice(middle, middle + SAMPLE), file.slice(size - SAMPLE, size)];
        const digest = await subtle.digest('SHA-256', await new Blob(parts).arrayBuffer());
        return `${size}:${hex(digest)}`;
    } catch {
        return null;
    }
}

/** The file size a fingerprint was taken from, or NaN when it isn't one. */
export function fingerprintSize(fingerprint) {
    const match = /^(\d+):[0-9a-f]{64}$/.exec(String(fingerprint || ''));
    return match ? Number(match[1]) : NaN;
}
