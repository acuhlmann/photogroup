import { concat, decodeUtf8, readBytes, readUint, uint, utf8 } from './binary';

// Matroska and WebM keep a title in Segment/Info and tags in Segment/Tags.
// The media (clusters) and the index pointing into it (cues) must not move,
// so only the part of the segment before the first cluster is rewritten,
// using the padding (Void) muxers leave there. When that doesn't fit (live
// recordings have none), old tags are blanked in place and the new ones go
// at the end of the file, with the segment size and index patched in place.

const ID = {
    SEGMENT: 0x18538067, SEEK_HEAD: 0x114D9B74, INFO: 0x1549A966, TAGS: 0x1254C367, CLUSTER: 0x1F43B675,
    VOID: 0xEC, CRC: 0xBF, SEEK: 0x4DBB, SEEK_ID: 0x53AB, SEEK_POSITION: 0x53AC, TITLE: 0x7BA9,
    TAG: 0x7373, TARGETS: 0x63C0, SIMPLE_TAG: 0x67C8, TAG_NAME: 0x45A3, TAG_STRING: 0x4487,
};
const TARGET_UIDS = new Set([0x63C5, 0x63C9, 0x63C4, 0x63C6]); // track, edition, chapter, attachment
const FIELDS = { title: ['TITLE'], description: ['DESCRIPTION', 'COMMENT'], rating: ['RATING'], keywords: ['KEYWORDS'] };

function idBytes(id) {
    const out = [];
    for (let value = id; value; value = Math.floor(value / 256)) out.unshift(value % 256);
    return out;
}

/** A variable-length integer: element IDs keep their length marker, sizes don't; -1 means "unknown size". */
function readVint(bytes, at, isId = false) {
    const first = bytes[at];
    let length = 1;
    while (length <= 8 && !(first & (0x80 >> (length - 1)))) length++;
    if (length > 8 || at + length > bytes.length) return null;
    let value = isId ? first : first & ((0x80 >> (length - 1)) - 1);
    let allOnes = value === (0x80 >> (length - 1)) - 1;
    for (let i = 1; i < length; i++) {
        value = value * 256 + bytes[at + i];
        if (bytes[at + i] !== 0xFF) allOnes = false;
    }
    return { value: !isId && allOnes ? -1 : value, length };
}

function sizeVint(value, length = null) {
    let width = length || 1;
    while (!length && value >= 2 ** (7 * width) - 1) width++;
    if (value >= 2 ** (7 * width) - 1) throw new Error('EBML size does not fit');
    const out = uint(value, width);
    out[0] |= 0x80 >> (width - 1);
    return out;
}

function element(id, data, sizeLength = null) {
    return concat([idBytes(id), sizeVint(data.length, sizeLength), data]);
}

/** A Void element exactly `length` bytes long (at least 2). */
function voidOf(length) {
    const sizeLength = length - 2 <= 126 ? 1 : 8;
    return concat([[ID.VOID], sizeVint(length - 1 - sizeLength, sizeLength), new Uint8Array(length - 1 - sizeLength)]);
}

function header(bytes, at) {
    const id = readVint(bytes, at, true);
    const size = id && readVint(bytes, at + id.length);
    if (!size) return null;
    const dataStart = at + id.length + size.length;
    return { id: id.value, start: at, dataStart, size: size.value, end: size.value < 0 ? -1 : dataStart + size.value, sizeLength: size.length };
}

function children(bytes, start, end) {
    const list = [];
    for (let at = start; at < end;) {
        const item = header(bytes, at);
        if (!item || item.end < 0 || item.end > end) return null;
        list.push(item);
        at = item.end;
    }
    return list;
}

const raw = (bytes, item) => bytes.subarray(item.start, item.end);

function tagText(name, value) {
    return element(ID.SIMPLE_TAG, concat([element(ID.TAG_NAME, utf8(name)), element(ID.TAG_STRING, utf8(value))]));
}

/** Tags with the shared details: the file's tags kept, the global fields being edited replaced. */
function rewriteTags(bytes, tagsList, details) {
    const replaced = new Set(Object.keys(FIELDS).filter(key => details[key] !== undefined).flatMap(key => FIELDS[key]));
    const kept = [];
    tagsList.forEach(({ source, item }) => {
        (children(source, item.dataStart, item.end) || []).filter(tag => tag.id === ID.TAG).forEach(tag => {
            const parts = children(source, tag.dataStart, tag.end) || [];
            const targets = parts.find(part => part.id === ID.TARGETS);
            const scoped = targets && (children(source, targets.dataStart, targets.end) || []).some(part => TARGET_UIDS.has(part.id));
            if (scoped) {
                kept.push(raw(source, tag));
                return;
            }
            const simple = parts.filter(part => {
                if (part.id !== ID.SIMPLE_TAG) return part.id !== ID.TARGETS;
                const name = (children(source, part.dataStart, part.end) || []).find(child => child.id === ID.TAG_NAME);
                return !name || !replaced.has(decodeUtf8(source.subarray(name.dataStart, name.end)).toUpperCase());
            });
            if (simple.some(part => part.id === ID.SIMPLE_TAG)) {
                kept.push(element(ID.TAG, concat([targets ? raw(source, targets) : element(ID.TARGETS, new Uint8Array(0)),
                    ...simple.map(part => raw(source, part))])));
            }
        });
    });
    const ours = [];
    if (details.title) ours.push(tagText('TITLE', details.title));
    if (details.description) ours.push(tagText('DESCRIPTION', details.description));
    if (details.rating > 0) ours.push(tagText('RATING', String(details.rating)));
    if (details.keywords && details.keywords.length) ours.push(tagText('KEYWORDS', details.keywords.join(', ')));
    if (ours.length) kept.unshift(element(ID.TAG, concat([element(ID.TARGETS, new Uint8Array(0)), ...ours])));
    return kept.length ? element(ID.TAGS, concat(kept)) : null;
}

/** Info with its Title replaced, or null when it doesn't change. */
function rewriteInfo(bytes, info, details) {
    if (!info || details.title === undefined) return null;
    // A rebuilt element's old checksum would no longer match, so it is dropped.
    const parts = (children(bytes, info.dataStart, info.end) || []).filter(part => part.id !== ID.TITLE && part.id !== ID.CRC)
        .map(part => raw(bytes, part));
    if (details.title) parts.push(element(ID.TITLE, utf8(details.title)));
    return element(ID.INFO, concat(parts));
}

export function matches(head) {
    return head[0] === 0x1A && head[1] === 0x45 && head[2] === 0xDF && head[3] === 0xA3;
}

export async function embed(blob, details) {
    const start = await readBytes(blob, 0, Math.min(blob.size, 64));
    const ebml = header(start, 0);
    const segment = ebml && ebml.end > 0 && header(start, ebml.end);
    if (!segment || segment.id !== ID.SEGMENT) return null;
    const segmentData = segment.dataStart;
    const unknownSize = segment.size < 0;
    if (!unknownSize && segment.end !== blob.size) return null; // several segments or trailing data

    // Everything before the first cluster.
    const top = [];
    let clusterStart = blob.size;
    for (let at = segmentData; at < blob.size;) {
        const item = header(await readBytes(blob, at, at + 16), 0);
        if (!item) return null;
        if (item.id === ID.CLUSTER) {
            clusterStart = at;
            break;
        }
        if (item.end < 0) return null;
        top.push({ ...item, start: at, dataStart: at + item.dataStart, end: at + item.end });
        at += item.end;
    }
    const bytes = await readBytes(blob, 0, clusterStart);
    const find = id => top.find(item => item.id === id);
    const seekHead = find(ID.SEEK_HEAD);
    const info = find(ID.INFO);
    const headTags = top.filter(item => item.id === ID.TAGS);

    // Index entries: [{seek, id, position, positionField}]
    const entries = [];
    (seekHead ? children(bytes, seekHead.dataStart, seekHead.end) || [] : []).filter(item => item.id === ID.SEEK).forEach(seek => {
        const parts = children(bytes, seek.dataStart, seek.end) || [];
        const id = parts.find(part => part.id === ID.SEEK_ID);
        const position = parts.find(part => part.id === ID.SEEK_POSITION);
        if (id && position) {
            entries.push({ seek, id: readUint(bytes, id.dataStart, id.end - id.dataStart),
                position: readUint(bytes, position.dataStart, position.end - position.dataStart), positionField: position });
        }
    });

    // Tags after the clusters, found through the index.
    const tailTags = [];
    for (const entry of entries.filter(item => item.id === ID.TAGS && segmentData + item.position >= clusterStart)) {
        const at = segmentData + entry.position;
        const head = header(await readBytes(blob, at, at + 16), 0);
        if (!head || head.id !== ID.TAGS || head.end < 0) return null;
        const source = await readBytes(blob, at, at + head.end);
        tailTags.push({ start: at, end: at + head.end, source, item: { ...head, start: 0 } });
    }

    const newTags = rewriteTags(bytes, [...headTags.map(item => ({ source: bytes, item })), ...tailTags], details);
    const newInfo = rewriteInfo(bytes, info, details);
    const blank = item => ({ start: item.start, end: item.end, bytes: voidOf(item.end - item.start) });

    // Plan A: lay out the head again in the same space.
    const available = clusterStart - segmentData;
    const kept = top.filter(item => item.id !== ID.SEEK_HEAD && item.id !== ID.VOID && item.id !== ID.TAGS);
    const body = kept.map(item => (item === info && newInfo ? newInfo : raw(bytes, item)));
    if (newTags) body.push(newTags);
    const layout = seekHeadSize => {
        // Where each element of the new head starts, relative to the segment data.
        const positions = new Map();
        let at = seekHeadSize;
        kept.forEach((item, i) => {
            positions.set(item, at);
            at += body[i].length;
        });
        return { positions, tagsAt: newTags ? at : null, used: at + (newTags ? newTags.length : 0) };
    };
    const buildSeekHead = ({ positions, tagsAt }) => {
        const seeks = [];
        const seen = new Set();
        entries.forEach(entry => {
            if (entry.id === ID.TAGS) {
                if (tagsAt === null || seen.has(ID.TAGS)) return;
                seen.add(ID.TAGS);
                seeks.push([ID.TAGS, tagsAt]);
                return;
            }
            const moved = kept.find(item => item.id === entry.id && item.start - segmentData === entry.position);
            seeks.push([entry.id, moved ? positions.get(moved) : entry.position]);
        });
        if (tagsAt !== null && !seen.has(ID.TAGS)) seeks.push([ID.TAGS, tagsAt]);
        return element(ID.SEEK_HEAD, concat(seeks.map(([id, position]) => element(ID.SEEK, concat([
            element(ID.SEEK_ID, new Uint8Array(idBytes(id))), element(ID.SEEK_POSITION, uint(position, 8)),
        ])))));
    };
    if (seekHead) {
        const seekHeadSize = buildSeekHead(layout(0)).length; // positions are fixed-width, so the size is known
        const plan = layout(seekHeadSize);
        const spare = available - plan.used;
        if (spare === 0 || spare >= 2) {
            const head = concat([buildSeekHead(plan), ...body, spare ? voidOf(spare) : new Uint8Array(0)]);
            const parts = [bytes.subarray(0, segmentData), head];
            let position = clusterStart;
            tailTags.forEach(tags => {
                parts.push(blob.slice(position, tags.start), blank(tags).bytes);
                position = tags.end;
            });
            parts.push(blob.slice(position));
            return new Blob(parts, { type: blob.type || 'video/x-matroska' });
        }
    }

    // Plan B: blank the old tags, change Info only if it keeps its size, append the new tags.
    const edits = [...headTags, ...tailTags].map(blank);
    if (newInfo) {
        const length = info.end - info.start;
        let replacement = null;
        if (newInfo.length === length) replacement = newInfo;
        else if (newInfo.length + 2 <= length) replacement = concat([newInfo, voidOf(length - newInfo.length)]);
        else {
            // The new title doesn't fit: blank the old one so it can't contradict the tags.
            const title = (children(bytes, info.dataStart, info.end) || []).find(part => part.id === ID.TITLE);
            if (title) edits.push(blank(title));
        }
        if (replacement) edits.push({ start: info.start, end: info.end, bytes: replacement });
    }
    const appendAt = blob.size - segmentData;
    const indexCrc = seekHead && (children(bytes, seekHead.dataStart, seekHead.end) || []).find(part => part.id === ID.CRC);
    if (indexCrc && entries.some(item => item.id === ID.TAGS)) edits.push(blank(indexCrc));
    for (const entry of entries.filter(item => item.id === ID.TAGS)) {
        const field = entry.positionField;
        const width = field.end - field.dataStart;
        if (newTags && appendAt < 2 ** (8 * width)) {
            edits.push({ start: field.dataStart, end: field.end, bytes: uint(appendAt, width) });
            break;
        }
        edits.push(blank(entry.seek));
    }
    if (!unknownSize && newTags) {
        const width = segment.sizeLength;
        try {
            edits.push({ start: segment.dataStart - width, end: segment.dataStart,
                bytes: sizeVint(segment.size + newTags.length, width) });
        } catch {
            return null;
        }
    }

    edits.sort((a, b) => a.start - b.start);
    const parts = [];
    let position = 0;
    edits.forEach(edit => {
        parts.push(blob.slice(position, edit.start), edit.bytes);
        position = edit.end;
    });
    parts.push(blob.slice(position));
    if (newTags) parts.push(newTags);
    return new Blob(parts, { type: blob.type || 'video/x-matroska' });
}
