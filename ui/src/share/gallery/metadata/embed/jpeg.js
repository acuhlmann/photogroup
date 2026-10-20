import Logger from 'js-logger';
import { ascii, concat, decodeUtf8, readBytes, readUint, uint, utf8 } from './binary';
import { applyDetailsToXmp } from './xmpPacket';
import { patchGps } from './exifGps';

// JPEG keeps XMP in an APP1 segment that starts with the XMP namespace, and
// EXIF (including GPS) in an APP1 segment that starts with "Exif".

const XMP_HEADER = 'http://ns.adobe.com/xap/1.0/\0';
const EXIF_HEADER = 'Exif\0\0';
const MAX_SEGMENT_LENGTH = 0xFFFF;

export function matches(head) {
    return head[0] === 0xFF && head[1] === 0xD8;
}

/** The segments before the image data, with the first XMP and Exif APP1 segments read. */
async function readSegments(blob) {
    const segments = [];
    let existing = null;
    let exif = null;
    let offset = 2;
    while (offset + 4 <= blob.size) {
        const head = await readBytes(blob, offset, offset + 4);
        if (head[0] !== 0xFF) break;
        if (head[1] === 0xFF) { offset++; continue; } // fill byte
        if (head[1] === 0xDA || head[1] === 0xD9) break; // image data or end
        const segment = { marker: head[1], start: offset, end: offset + 2 + readUint(head, 2, 2) };
        if (segment.marker === 0xE1 && (!existing || !exif)) {
            const payload = await readBytes(blob, segment.start + 4, segment.end);
            if (!existing && ascii(payload, 0, XMP_HEADER.length) === XMP_HEADER) {
                existing = segment;
                existing.xml = decodeUtf8(payload.subarray(XMP_HEADER.length));
            } else if (!exif && ascii(payload, 0, EXIF_HEADER.length) === EXIF_HEADER) {
                exif = { ...segment, payload };
            }
        }
        segments.push(segment);
        offset = segment.end;
    }
    return { segments, existing, exif };
}

/** The photo's EXIF as a TIFF block, or null when it has none. */
export async function readExif(blob) {
    const { exif } = await readSegments(blob);
    return exif ? exif.payload.subarray(EXIF_HEADER.length) : null;
}

export async function embed(blob, details) {
    const { segments, existing, exif } = await readSegments(blob);
    const payload = utf8(XMP_HEADER + applyDetailsToXmp(existing && existing.xml, details));
    const length = payload.length + 2;
    if (length > MAX_SEGMENT_LENGTH) {
        Logger.warn('Photo details are too large to embed; saving the original file');
        return null;
    }
    const segment = concat([[0xFF, 0xE1], uint(length, 2), payload]);

    const edits = [];
    if (existing) {
        edits.push({ start: existing.start, end: existing.end, bytes: segment });
    } else {
        // Keep JFIF/Exif first, as readers expect, and put XMP right after them.
        const leading = segments.findIndex(item => item.marker !== 0xE0 && item.marker !== 0xE1);
        const anchor = leading < 0 ? segments[segments.length - 1] : segments[leading - 1];
        const at = anchor ? anchor.end : 2;
        edits.push({ start: at, end: at, bytes: segment });
    }
    // Readers often trust EXIF GPS over XMP, so fix its values too when the fields exist.
    if (details.location !== undefined && exif) {
        const tiff = patchGps(exif.payload.subarray(EXIF_HEADER.length), details.location);
        if (tiff) {
            const header = await readBytes(blob, exif.start, exif.start + 4);
            edits.push({ start: exif.start, end: exif.end, bytes: concat([header, exif.payload.subarray(0, EXIF_HEADER.length), tiff]) });
        }
    }

    edits.sort((a, b) => a.start - b.start);
    const parts = [];
    let position = 0;
    edits.forEach(item => {
        parts.push(blob.slice(position, item.start), item.bytes);
        position = item.end;
    });
    parts.push(blob.slice(position));
    return new Blob(parts, { type: blob.type || 'image/jpeg' });
}
