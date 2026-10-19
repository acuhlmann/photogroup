import { ascii, concat, decodeUtf8, latin1, readBytes, utf8 } from './binary';
import { applyDetailsToXmp } from './xmpPacket';

// GIF keeps XMP in an application extension named "XMP DataXMP". The XML
// is written raw, followed by a 258-byte "magic trailer" that lets readers
// skip it as if it were ordinary sub-blocks.

const XMP_APP = 'XMP DataXMP';
const MAGIC_TRAILER = concat([[1], Array.from({ length: 256 }, (_, i) => 255 - i), [0]]);

/** Index just past a run of sub-blocks (length-prefixed, ending with a zero length). */
function skipSubBlocks(bytes, at) {
    while (at < bytes.length && bytes[at] !== 0) at += bytes[at] + 1;
    return at + 1;
}

export function matches(head) {
    return ascii(head, 0, 6) === 'GIF89a' || ascii(head, 0, 6) === 'GIF87a';
}

export async function embed(blob, details) {
    const bytes = await readBytes(blob, 0, blob.size);
    const flags = bytes[10];
    const headerEnd = 13 + (flags & 0x80 ? 3 * 2 ** ((flags & 7) + 1) : 0);

    let existing = null;
    for (let at = headerEnd; at < bytes.length;) {
        const marker = bytes[at];
        if (marker === 0x3B) break; // trailer
        if (marker === 0x21) {
            const end = skipSubBlocks(bytes, at + 2);
            if (bytes[at + 1] === 0xFF && bytes[at + 2] === 11 && ascii(bytes, at + 3, 11) === XMP_APP) {
                const text = decodeUtf8(bytes.subarray(at + 14, end));
                const match = text.match(/<\?xpacket begin[\s\S]*?<\?xpacket end[^>]*>|<x:xmpmeta[\s\S]*?<\/x:xmpmeta>/);
                existing = { start: at, end, xml: match ? match[0] : null };
            }
            at = end;
        } else if (marker === 0x2C) {
            const local = bytes[at + 9] & 0x80 ? 3 * 2 ** ((bytes[at + 9] & 7) + 1) : 0;
            at = skipSubBlocks(bytes, at + 10 + local + 1); // descriptor, colour table, LZW code size
        } else {
            return null; // not a block layout this understands
        }
    }

    const xml = applyDetailsToXmp(existing && existing.xml, details);
    const extension = concat([[0x21, 0xFF, 11], latin1(XMP_APP), utf8(xml), MAGIC_TRAILER]);
    // Extensions need GIF89a.
    const header = concat([latin1('GIF89a'), bytes.subarray(6, headerEnd)]);
    const before = existing ? existing.start : headerEnd;
    const after = existing ? existing.end : headerEnd;
    return new Blob([header, bytes.subarray(headerEnd, before), extension, bytes.subarray(after)], { type: blob.type || 'image/gif' });
}
