import { ascii, concat, latin1, readBytes, readUint, uint } from './binary';

// ISO base media file format boxes, shared by MP4/MOV/M4A and HEIF/AVIF.

/** Child boxes of bytes[start, end). Throws on a box that overruns its parent. */
export function parseBoxes(bytes, start = 0, end = bytes.length) {
    const boxes = [];
    let offset = start;
    while (offset + 8 <= end) {
        let size = readUint(bytes, offset, 4);
        const type = ascii(bytes, offset + 4, 4);
        let header = 8;
        if (size === 1) {
            size = readUint(bytes, offset + 8, 8);
            header = 16;
        } else if (size === 0) {
            size = end - offset;
        }
        if (size < header || offset + size > end) throw new Error(`Malformed ${type} box`);
        boxes.push({ type, start: offset, end: offset + size, header });
        offset += size;
    }
    return boxes;
}

/** Top-level boxes of a file, reading only their headers. */
export async function scanBoxes(blob) {
    const boxes = [];
    let offset = 0;
    while (offset + 8 <= blob.size) {
        const head = await readBytes(blob, offset, offset + 16);
        let size = readUint(head, 0, 4);
        const type = ascii(head, 4, 4);
        let header = 8;
        if (size === 1) {
            size = readUint(head, 8, 8);
            header = 16;
        } else if (size === 0) {
            size = blob.size - offset;
        }
        if (size < header || offset + size > blob.size) throw new Error(`Malformed ${type} box`);
        boxes.push({ type, start: offset, end: offset + size, header });
        offset += size;
    }
    return boxes;
}

export function box(type, ...parts) {
    const body = concat(parts);
    return concat([uint(body.length + 8, 4), latin1(type), body]);
}

/** The major and compatible brands from a leading ftyp box, or null. */
export function brands(head) {
    if (ascii(head, 4, 4) !== 'ftyp') return null;
    const end = Math.min(readUint(head, 0, 4), head.length);
    const list = [ascii(head, 8, 4)];
    for (let offset = 16; offset + 4 <= end; offset += 4) list.push(ascii(head, offset, 4));
    return list;
}
