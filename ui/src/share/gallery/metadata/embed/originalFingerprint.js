// A copy saved from PhotoGroup with the room's details notes the original's
// fingerprint in its XMP (`pg:OriginalFingerprint`, see xmpPacket.js). The
// XMP sits near the start of a JPEG, HEIF or GIF and can be at the end of a
// PNG or WebP, so both ends are read instead of parsing every format.

const EDGE = 256 * 1024;
const PATTERN = /pg:OriginalFingerprint(?:="|>)(\d+:[0-9a-f]{64})/;

/** The original's fingerprint noted in this file, or null when there is none. */
export async function readOriginalFingerprint(file) {
    if (!file || typeof file.slice !== 'function') return null;
    const parts = file.size <= EDGE * 2
        ? [file]
        : [file.slice(0, EDGE), file.slice(file.size - EDGE)];
    for (const part of parts) {
        const text = new TextDecoder('latin1').decode(await part.arrayBuffer());
        const match = PATTERN.exec(text);
        if (match) return match[1];
    }
    return null;
}
