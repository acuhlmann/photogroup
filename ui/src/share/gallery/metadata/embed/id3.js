import { ascii, concat, latin1, readBytes, readUint, ratingFraction, uint, utf16 } from './binary';

// MP3 keeps tags in an ID3v2 block at the start of the file. Frames other
// than the ones being replaced are copied through untouched.

const syncsafe = (bytes, offset) => (bytes[offset] << 21) | (bytes[offset + 1] << 14) | (bytes[offset + 2] << 7) | bytes[offset + 3];
const toSyncsafe = value => [(value >> 21) & 0x7F, (value >> 14) & 0x7F, (value >> 7) & 0x7F, value & 0x7F];

function frame(id, data, major) {
    const size = major === 4 ? toSyncsafe(data.length) : uint(data.length, 4);
    return concat([latin1(id), size, [0, 0], data]);
}

/** The untitled COMM frame, the one players show as "comment". */
function isMainComment(frameBytes) {
    if (frameBytes[9]) return false; // compressed, encrypted or otherwise transformed
    const encoding = frameBytes[10];
    const descriptor = frameBytes.subarray(14, 18);
    if (encoding === 0 || encoding === 3) return descriptor[0] === 0;
    if (descriptor[0] === 0 && descriptor[1] === 0) return true;
    return (descriptor[0] === 0xFF || descriptor[0] === 0xFE) && descriptor[2] === 0 && descriptor[3] === 0;
}

function isMpegFrame(bytes) {
    return bytes[0] === 0xFF && (bytes[1] & 0xE0) === 0xE0 && ((bytes[1] >> 1) & 3) !== 0;
}

export function matches(head) {
    return ascii(head, 0, 3) === 'ID3' || isMpegFrame(head);
}

export async function embed(blob, details) {
    let major = 3;
    let frames = [];
    let audioStart = 0;
    const head = await readBytes(blob, 0, 10);
    if (ascii(head, 0, 3) === 'ID3') {
        major = head[3];
        const flags = head[5];
        // v2.2 and whole-tag unsynchronisation use layouts not handled here.
        if (major < 3 || major > 4 || flags & 0x80) return null;
        const size = syncsafe(head, 6);
        audioStart = 10 + size + (flags & 0x10 ? 10 : 0);

        const tag = await readBytes(blob, 10, 10 + size);
        let offset = 0;
        if (flags & 0x40) offset = major === 4 ? syncsafe(tag, 0) : readUint(tag, 0, 4) + 4;
        while (offset + 10 <= tag.length && tag[offset] !== 0) {
            const frameSize = major === 4 ? syncsafe(tag, offset + 4) : readUint(tag, offset + 4, 4);
            const end = offset + 10 + frameSize;
            if (end > tag.length) break;
            frames.push({ id: ascii(tag, offset, 4), bytes: tag.subarray(offset, end) });
            offset = end;
        }
    }

    if (details.title !== undefined) frames = frames.filter(item => item.id !== 'TIT2');
    if (details.description !== undefined) frames = frames.filter(item => item.id !== 'COMM' || !isMainComment(item.bytes));
    if (details.rating !== undefined) frames = frames.filter(item => item.id !== 'POPM');

    const added = [];
    if (details.title) added.push(frame('TIT2', concat([[1], utf16(details.title)]), major));
    if (details.description) {
        added.push(frame('COMM', concat([[1], latin1('eng'), [0xFF, 0xFE, 0, 0], utf16(details.description)]), major));
    }
    const rating = ratingFraction(details.rating);
    if (rating !== null) added.push(frame('POPM', [0, Math.max(1, Math.round(rating * 255))], major));

    const body = concat([...frames.map(item => item.bytes), ...added]);
    const header = concat([latin1('ID3'), [major, 0, 0], toSyncsafe(body.length)]);
    return new Blob([header, body, blob.slice(audioStart)], { type: blob.type || 'audio/mpeg' });
}
