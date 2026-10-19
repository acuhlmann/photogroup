import { ascii, concat, latin1, readBytes, readUint, uint } from './binary';
import { applyDetails, buildComments, DEFAULT_VENDOR, parseComments } from './vorbisComments';

// FLAC keeps tags as Vorbis comments ("TITLE=...") in a metadata block
// ahead of the audio frames.

const VORBIS_COMMENT = 4;

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
        : { vendor: DEFAULT_VENDOR, comments: [] };
    const data = buildComments(vendor, applyDetails(comments, details));
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
