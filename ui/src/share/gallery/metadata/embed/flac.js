import { ascii, concat, decodeUtf8, latin1, readBytes, readUint, readUintLE, ratingFraction, uint, uintLE, utf8 } from './binary';

// FLAC keeps tags as Vorbis comments ("TITLE=...") in a metadata block
// ahead of the audio frames.

const VORBIS_COMMENT = 4;
const FIELDS = { title: ['TITLE'], description: ['DESCRIPTION', 'COMMENT'], rating: ['RATING'] };

function parseComments(data) {
    const vendorLength = readUintLE(data, 0, 4);
    const vendor = data.subarray(4, 4 + vendorLength);
    let offset = 4 + vendorLength;
    const count = readUintLE(data, offset, 4);
    offset += 4;
    const comments = [];
    for (let i = 0; i < count && offset + 4 <= data.length; i++) {
        const length = readUintLE(data, offset, 4);
        comments.push(decodeUtf8(data.subarray(offset + 4, offset + 4 + length)));
        offset += 4 + length;
    }
    return { vendor, comments };
}

export function matches(head) {
    return ascii(head, 0, 4) === 'fLaC';
}

export async function embed(blob, details) {
    const blocks = [];
    let offset = 4;
    for (;;) {
        if (offset + 4 > blob.size) return null;
        const head = await readBytes(blob, offset, offset + 4);
        const block = { type: head[0] & 0x7F, start: offset + 4, end: offset + 4 + readUint(head, 1, 3) };
        blocks.push(block);
        offset = block.end;
        if (head[0] & 0x80) break;
    }

    const existing = blocks.find(block => block.type === VORBIS_COMMENT);
    const { vendor, comments } = existing
        ? parseComments(await readBytes(blob, existing.start, existing.end))
        : { vendor: latin1('PhotoGroup'), comments: [] };

    const replaced = Object.keys(FIELDS).filter(key => details[key] !== undefined).flatMap(key => FIELDS[key]);
    const kept = comments.filter(comment => !replaced.includes(comment.split('=')[0].toUpperCase()));
    if (details.title) kept.push('TITLE=' + details.title);
    if (details.description) kept.push('DESCRIPTION=' + details.description);
    const rating = ratingFraction(details.rating);
    if (rating !== null) kept.push('RATING=' + Math.max(1, Math.round(rating * 100)));

    const entries = kept.map(utf8);
    const data = concat([uintLE(vendor.length, 4), vendor, uintLE(entries.length, 4),
        ...entries.flatMap(entry => [uintLE(entry.length, 4), entry])]);
    if (data.length > 0xFFFFFF) return null;

    const order = existing ? blocks : [blocks[0], { type: VORBIS_COMMENT }, ...blocks.slice(1)];
    const parts = [latin1('fLaC')];
    order.forEach((block, i) => {
        const last = i === order.length - 1 ? 0x80 : 0;
        const isComments = block.type === VORBIS_COMMENT && (block === existing || !block.start);
        const length = isComments ? data.length : block.end - block.start;
        parts.push(concat([[block.type | last], uint(length, 3)]), isComments ? data : blob.slice(block.start, block.end));
    });
    parts.push(blob.slice(offset));
    return new Blob(parts, { type: blob.type || 'audio/flac' });
}
