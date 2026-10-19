import { ascii, concat, decodeUtf8, latin1, readBytes, readUint, readUintLE, uintLE, utf8 } from './binary';
import { applyDetailsToXmp } from './xmpPacket';

// WebP keeps XMP in an "XMP " chunk, which only the extended (VP8X) layout
// allows, so a simple lossy or lossless file is upgraded to it.

const XMP_FLAG = 0x04;
const ALPHA_FLAG = 0x10;

function riffChunk(type, data) {
    return concat([latin1(type), uintLE(data.length, 4), data, data.length % 2 ? [0] : []]);
}

/** A VP8X header for a simple file, sized from its VP8 or VP8L bitstream. */
function extendedHeader(type, data) {
    let width;
    let height;
    let flags = XMP_FLAG;
    if (type === 'VP8L') {
        const bits = readUintLE(data, 1, 4);
        width = (bits & 0x3FFF) + 1;
        height = ((bits >>> 14) & 0x3FFF) + 1;
        if ((bits >>> 28) & 1) flags |= ALPHA_FLAG;
    } else {
        width = readUintLE(data, 6, 2) & 0x3FFF;
        height = readUintLE(data, 8, 2) & 0x3FFF;
    }
    return riffChunk('VP8X', concat([[flags, 0, 0, 0], uintLE(width - 1, 3), uintLE(height - 1, 3)]));
}

export function matches(head) {
    return ascii(head, 0, 4) === 'RIFF' && ascii(head, 8, 4) === 'WEBP';
}

export async function embed(blob, details) {
    const chunks = [];
    let offset = 12;
    while (offset + 8 <= blob.size) {
        const head = await readBytes(blob, offset, offset + 8);
        const size = readUintLE(head, 4, 4);
        const item = { type: ascii(head, 0, 4), start: offset, end: Math.min(offset + 8 + size + (size % 2), blob.size) };
        if (item.type === 'VP8X' || item.type === 'VP8 ' || item.type === 'VP8L') {
            item.data = await readBytes(blob, offset + 8, Math.min(offset + 8 + size, offset + 40));
        } else if (item.type === 'XMP ') {
            item.xml = decodeUtf8(await readBytes(blob, offset + 8, offset + 8 + size));
        }
        chunks.push(item);
        offset = item.end;
    }
    const first = chunks[0];
    if (!first || !['VP8X', 'VP8 ', 'VP8L'].includes(first.type)) return null;
    if (first.type === 'VP8 ' && readUint(first.data, 3, 3) !== 0x9D012A) return null;

    const existing = chunks.find(item => item.type === 'XMP ');
    const xmp = riffChunk('XMP ', utf8(applyDetailsToXmp(existing && existing.xml, details)));
    const parts = [];
    if (first.type === 'VP8X') {
        const header = blob.slice(first.start, first.end);
        const flags = new Uint8Array([first.data[0] | XMP_FLAG]);
        parts.push(header.slice(0, 8), flags, header.slice(9));
    } else {
        parts.push(extendedHeader(first.type, first.data), blob.slice(first.start, first.end));
    }
    chunks.slice(1).filter(item => item !== existing).forEach(item => parts.push(blob.slice(item.start, item.end)));
    parts.push(xmp);

    const body = new Blob(parts);
    return new Blob([latin1('RIFF'), uintLE(body.size + 4, 4), latin1('WEBP'), body], { type: blob.type || 'image/webp' });
}
