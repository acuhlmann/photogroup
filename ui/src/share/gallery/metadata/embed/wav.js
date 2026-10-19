import { ascii, concat, latin1, readBytes, readUintLE, uintLE, utf8 } from './binary';
import { rewriteTag } from './id3';

// WAV (RIFF/WAVE) tags live in two places that players read: a LIST/INFO
// chunk (INAM title, ICMT comment) and an "id3 " chunk holding an ID3v2
// tag, which can also carry a rating. Both are updated; chunks that don't
// exist yet go at the end.

function chunk(id, data) {
    return concat([latin1(id), uintLE(data.length, 4), data, data.length % 2 ? [0] : []]);
}

/** LIST/INFO with INAM/ICMT replaced, or null when there would be nothing in it. */
function rewriteInfo(info, details) {
    const kept = [];
    if (info) {
        for (let at = 4; at + 8 <= info.length;) {
            const id = ascii(info, at, 4);
            const size = readUintLE(info, at + 4, 4);
            const end = at + 8 + size + (size % 2);
            if ((id === 'INAM' && details.title !== undefined) || (id === 'ICMT' && details.description !== undefined)) {
                at = end;
                continue;
            }
            kept.push(info.subarray(at, Math.min(end, info.length)));
            at = end;
        }
    }
    const text = value => concat([utf8(value), [0]]);
    if (details.title) kept.push(chunk('INAM', text(details.title)));
    if (details.description) kept.push(chunk('ICMT', text(details.description)));
    return kept.length ? chunk('LIST', concat([latin1('INFO'), ...kept])) : null;
}

export function matches(head) {
    return ascii(head, 0, 4) === 'RIFF' && ascii(head, 8, 4) === 'WAVE';
}

export async function embed(blob, details) {
    const chunks = [];
    for (let offset = 12; offset + 8 <= blob.size;) {
        const head = await readBytes(blob, offset, offset + 12);
        const size = readUintLE(head, 4, 4);
        const item = { id: ascii(head, 0, 4), start: offset, end: Math.min(offset + 8 + size + (size % 2), blob.size) };
        if (item.id === 'LIST') item.listType = ascii(head, 8, 4);
        chunks.push(item);
        offset = item.end;
    }
    const info = chunks.find(item => item.id === 'LIST' && item.listType === 'INFO');
    const id3 = chunks.find(item => item.id === 'id3 ' || item.id === 'ID3 ');

    const newInfo = rewriteInfo(info ? await readBytes(blob, info.start + 8, info.end) : null, details);
    const newTag = rewriteTag(id3 ? await readBytes(blob, id3.start + 8, id3.end) : null, details);
    if (!newTag) return null;
    const newId3 = chunk(id3 ? id3.id : 'id3 ', newTag);

    const parts = [];
    chunks.forEach(item => {
        if (item === info) {
            if (newInfo) parts.push(newInfo);
        } else if (item === id3) {
            parts.push(newId3);
        } else {
            parts.push(blob.slice(item.start, item.end));
        }
    });
    if (!info && newInfo) parts.push(newInfo);
    if (!id3) parts.push(newId3);

    const body = new Blob(parts);
    return new Blob([latin1('RIFF'), uintLE(body.size + 4, 4), latin1('WAVE'), body], { type: blob.type || 'audio/wav' });
}
