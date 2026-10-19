import { ascii, concat, readBytes, readUintLE, uintLE } from './binary';
import { applyDetails, buildComments, parseComments } from './vorbisComments';

// Ogg Vorbis and Opus keep tags as Vorbis comments in the stream's second
// packet. Packets are split into pages, each with a sequence number and a
// checksum, so the header packets are paged again and, when the number of
// pages changes, every later page is renumbered.

const CRC_TABLE = Array.from({ length: 256 }, (_, n) => {
    let c = n << 24;
    for (let k = 0; k < 8; k++) c = c & 0x80000000 ? (c << 1) ^ 0x04C11DB7 : c << 1;
    return c >>> 0;
});

function crc(bytes) {
    let c = 0;
    for (const byte of bytes) c = ((c << 8) ^ CRC_TABLE[((c >>> 24) ^ byte) & 0xFF]) >>> 0;
    return c;
}

/** Fill in a page's checksum (bytes 22–25), computed with that field zeroed. */
function seal(page) {
    page.fill(0, 22, 26);
    page.set(uintLE(crc(page), 4), 22);
    return page;
}

function parsePage(bytes, at) {
    if (at + 27 > bytes.length || ascii(bytes, at, 4) !== 'OggS') return null;
    const count = bytes[at + 26];
    if (at + 27 + count > bytes.length) return null;
    const lacing = Array.from(bytes.subarray(at + 27, at + 27 + count));
    const dataStart = at + 27 + count;
    const end = dataStart + lacing.reduce((sum, value) => sum + value, 0);
    if (end > bytes.length) return null;
    return { start: at, end, dataStart, lacing, flags: bytes[at + 5], serial: readUintLE(bytes, at + 14, 4) };
}

/** Header packets laid out in pages, each sealed. */
function paginate(packets, serial, firstSequence) {
    const lacing = [];
    packets.forEach(packet => {
        for (let left = packet.length; ; left -= 255) {
            lacing.push({ value: Math.min(left, 255), packet });
            if (left < 255) break;
        }
    });
    const data = concat(packets);
    const pages = [];
    let offset = 0;
    let continued = false;
    for (let i = 0; i < lacing.length; i += 255) {
        const values = lacing.slice(i, i + 255).map(item => item.value);
        const size = values.reduce((sum, value) => sum + value, 0);
        const page = concat([
            [0x4F, 0x67, 0x67, 0x53, 0, continued ? 1 : 0], new Uint8Array(8), uintLE(serial, 4),
            uintLE(firstSequence + pages.length, 4), new Uint8Array(4), [values.length], values,
            data.subarray(offset, offset + size),
        ]);
        pages.push(seal(page));
        offset += size;
        continued = values[values.length - 1] === 255;
    }
    return pages;
}

export function matches(head) {
    return ascii(head, 0, 4) === 'OggS';
}

const MAX_HEADERS = 1024 * 1024;

export async function embed(blob, details) {
    const head = await readBytes(blob, 0, Math.min(blob.size, MAX_HEADERS));
    const first = parsePage(head, 0);
    if (!first || !(first.flags & 0x02)) return null;

    // Collect the stream's header packets: identification, comments, and Vorbis's setup.
    const packets = [];
    let current = [];
    let codec = null;
    let wanted = 3;
    let at = 0;
    let headerEnd = null;
    let headerPages = 0;
    while (packets.length < wanted) {
        const page = parsePage(head, at);
        if (!page || page.serial !== first.serial) return null; // several streams, or headers too large
        let offset = page.dataStart;
        page.lacing.forEach(value => {
            current.push(head.subarray(offset, offset + value));
            offset += value;
            if (value < 255) {
                packets.push(concat(current));
                current = [];
            }
        });
        if (packets.length && !codec) {
            if (ascii(packets[0], 0, 8) === 'OpusHead') { codec = 'opus'; wanted = 2; } else if (ascii(packets[0], 1, 6) === 'vorbis') codec = 'vorbis';
            else return null; // Theora, FLAC-in-Ogg and others: leave alone
        }
        if (at === 0 && (packets.length !== 1 || current.length)) return null; // the first page holds only the identification
        if (at > 0) headerPages += 1;
        at = page.end;
        if (packets.length >= wanted) {
            if (current.length || packets.length > wanted) return null; // audio shares the last header page
            headerEnd = page.end;
        }
    }

    const comments = packets[1];
    const prefix = codec === 'opus' ? 8 : 7;
    if (codec === 'opus' ? ascii(comments, 0, 8) !== 'OpusTags' : comments[0] !== 3) return null;
    const parsed = parseComments(comments, prefix);
    const body = buildComments(parsed.vendor, applyDetails(parsed.comments, details));
    // Vorbis ends with a framing bit; Opus may carry extra data after the comments.
    const tail = codec === 'opus' ? comments.subarray(parsed.end) : new Uint8Array([1]);
    const packet = concat([comments.subarray(0, prefix), body, tail]);

    const pages = paginate(codec === 'opus' ? [packet] : [packet, packets[2]], first.serial, 1);
    const shift = pages.length - headerPages;
    const parts = [head.subarray(0, first.end), ...pages];
    if (!shift) {
        parts.push(blob.slice(headerEnd));
    } else {
        // Renumber the rest; pages are read and sealed again one by one.
        const rest = await readBytes(blob, headerEnd, blob.size);
        let offset = 0;
        while (offset < rest.length) {
            const page = parsePage(rest, offset);
            if (!page || page.serial !== first.serial) return null;
            const copy = rest.slice(page.start, page.end);
            copy.set(uintLE(readUintLE(copy, 18, 4) + shift, 4), 18);
            parts.push(seal(copy));
            offset = page.end;
        }
    }
    return new Blob(parts, { type: blob.type || (codec === 'opus' ? 'audio/ogg; codecs=opus' : 'audio/ogg') });
}
