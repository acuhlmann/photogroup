import Logger from 'js-logger';
import { ascii, concat, decodeUtf8, readBytes, readUint, uint, utf8 } from './binary';
import { applyDetailsToXmp } from './xmpPacket';

// JPEG keeps XMP in an APP1 segment that starts with the XMP namespace.

const XMP_HEADER = 'http://ns.adobe.com/xap/1.0/\0';
const MAX_SEGMENT_LENGTH = 0xFFFF;

export function matches(head) {
    return head[0] === 0xFF && head[1] === 0xD8;
}

export async function embed(blob, details) {
    const segments = [];
    let existing = null;
    let offset = 2;
    while (offset + 4 <= blob.size) {
        const head = await readBytes(blob, offset, offset + 4);
        if (head[0] !== 0xFF) break;
        if (head[1] === 0xFF) { offset++; continue; } // fill byte
        if (head[1] === 0xDA || head[1] === 0xD9) break; // image data or end
        const segment = { marker: head[1], start: offset, end: offset + 2 + readUint(head, 2, 2) };
        if (segment.marker === 0xE1 && !existing) {
            const payload = await readBytes(blob, segment.start + 4, segment.end);
            if (ascii(payload, 0, XMP_HEADER.length) === XMP_HEADER) {
                existing = segment;
                existing.xml = decodeUtf8(payload.subarray(XMP_HEADER.length));
            }
        }
        segments.push(segment);
        offset = segment.end;
    }

    const payload = utf8(XMP_HEADER + applyDetailsToXmp(existing && existing.xml, details));
    const length = payload.length + 2;
    if (length > MAX_SEGMENT_LENGTH) {
        Logger.warn('Photo details are too large to embed; saving the original file');
        return null;
    }
    const segment = concat([[0xFF, 0xE1], uint(length, 2), payload]);

    let before;
    let after;
    if (existing) {
        before = existing.start;
        after = existing.end;
    } else {
        // Keep JFIF/Exif first, as readers expect, and put XMP right after them.
        const leading = segments.findIndex(item => item.marker !== 0xE0 && item.marker !== 0xE1);
        const anchor = leading < 0 ? segments[segments.length - 1] : segments[leading - 1];
        before = after = anchor ? anchor.end : 2;
    }
    return new Blob([blob.slice(0, before), segment, blob.slice(after)], { type: blob.type || 'image/jpeg' });
}
