import Logger from 'js-logger';
import { ascii, concat, decodeUtf8, latin1, readBytes, readUint, uint, utf8 } from './binary';
import { applyDetailsToXmp } from './xmpPacket';

// PNG keeps XMP in an iTXt chunk with the keyword "XML:com.adobe.xmp".

const SIGNATURE = [0x89, 0x50, 0x4E, 0x47, 0x0D, 0x0A, 0x1A, 0x0A];
const XMP_KEYWORD = 'XML:com.adobe.xmp';

const CRC_TABLE = Array.from({ length: 256 }, (_, n) => {
    let c = n;
    for (let k = 0; k < 8; k++) c = c & 1 ? 0xEDB88320 ^ (c >>> 1) : c >>> 1;
    return c >>> 0;
});

function crc32(bytes) {
    let crc = 0xFFFFFFFF;
    for (const byte of bytes) crc = CRC_TABLE[(crc ^ byte) & 0xFF] ^ (crc >>> 8);
    return (crc ^ 0xFFFFFFFF) >>> 0;
}

function chunk(type, data) {
    const body = concat([latin1(type), data]);
    return concat([uint(data.length, 4), body, uint(crc32(body), 4)]);
}

async function inflate(bytes) {
    const stream = new Response(bytes).body.pipeThrough(new DecompressionStream('deflate'));
    return new Uint8Array(await new Response(stream).arrayBuffer());
}

/** The XMP text of an iTXt chunk, or undefined when the chunk holds something else. */
async function readXmp(data) {
    if (ascii(data, 0, XMP_KEYWORD.length + 1) !== XMP_KEYWORD + '\0') return undefined;
    let offset = XMP_KEYWORD.length + 1;
    const compressed = data[offset] === 1;
    offset += 2;
    offset = data.indexOf(0, offset) + 1; // language tag
    offset = data.indexOf(0, offset) + 1; // translated keyword
    const text = data.subarray(offset);
    if (!compressed) return decodeUtf8(text);
    try {
        return decodeUtf8(await inflate(text));
    } catch (error) {
        Logger.warn('Could not read compressed XMP: ' + error.message);
        return null;
    }
}

export function matches(head) {
    return SIGNATURE.every((byte, i) => head[i] === byte);
}

export async function embed(blob, details) {
    let existing = null;
    let ihdrEnd = null;
    let offset = SIGNATURE.length;
    while (offset + 8 <= blob.size) {
        const head = await readBytes(blob, offset, offset + 8);
        const type = ascii(head, 4, 4);
        const end = offset + 12 + readUint(head, 0, 4);
        if (type === 'IHDR') ihdrEnd = end;
        if (type === 'iTXt' && !existing) {
            const xml = await readXmp(await readBytes(blob, offset + 8, end - 4));
            if (xml !== undefined) existing = { start: offset, end, xml };
        }
        if (type === 'IDAT' || type === 'IEND') break;
        offset = end;
    }
    if (ihdrEnd === null) return null;

    const xml = applyDetailsToXmp(existing && existing.xml, details);
    const data = concat([latin1(XMP_KEYWORD), [0, 0, 0, 0, 0], utf8(xml)]);
    const before = existing ? existing.start : ihdrEnd;
    const after = existing ? existing.end : ihdrEnd;
    return new Blob([blob.slice(0, before), chunk('iTXt', data), blob.slice(after)], { type: blob.type || 'image/png' });
}
