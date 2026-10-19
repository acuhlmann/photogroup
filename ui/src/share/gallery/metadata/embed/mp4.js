import { ascii, latin1, readBytes, readUint, ratingFraction, uint, utf8 } from './binary';
import { box, brands, parseBoxes, scanBoxes } from './isobmff';

// MP4, MOV and M4A keep tags as iTunes-style items under moov/udta/meta/ilst.
// Rewriting moov changes its size, so when the media data comes after it
// the chunk offset tables (stco/co64) are shifted to match.

const ITEMS = { title: '©nam', description: 'desc', rating: 'rate' };
const QUICKTIME_TYPES = new Set(['moov', 'mdat', 'wide', 'free', 'skip']);

function textItem(type, text) {
    return box(type, box('data', uint(1, 4), uint(0, 4), utf8(text)));
}

function newItems(details) {
    const items = [];
    if (details.title) items.push(textItem(ITEMS.title, details.title));
    if (details.description) items.push(textItem(ITEMS.description, details.description));
    const rating = ratingFraction(details.rating);
    if (rating !== null) items.push(textItem(ITEMS.rating, String(Math.max(1, Math.round(rating * 100)))));
    return items;
}

const contents = (bytes, item, skip = 0) => parseBoxes(bytes, item.start + item.header + skip, item.end);
const raw = (bytes, item) => bytes.subarray(item.start, item.end);

/** udta with the shared details merged into its ilst, or null when it uses another tag scheme. */
function rebuildUserData(bytes, udta, details) {
    const kids = udta ? contents(bytes, udta) : [];
    const meta = kids.find(kid => kid.type === 'meta');
    let prefix = [0, 0, 0, 0];
    let metaKids = [];
    if (meta) {
        // ISO meta is a full box; QuickTime's starts straight with hdlr.
        const quickTime = ascii(bytes, meta.start + meta.header + 4, 4) === 'hdlr';
        prefix = quickTime ? [] : bytes.subarray(meta.start + meta.header, meta.start + meta.header + 4);
        metaKids = contents(bytes, meta, quickTime ? 0 : 4);
        const hdlr = metaKids.find(kid => kid.type === 'hdlr');
        if (hdlr && ascii(bytes, hdlr.start + hdlr.header + 8, 4) !== 'mdir') return null;
    }

    const ilst = metaKids.find(kid => kid.type === 'ilst');
    const replaced = new Set(Object.keys(ITEMS).filter(key => details[key] !== undefined).map(key => ITEMS[key]));
    const kept = ilst ? contents(bytes, ilst).filter(item => !replaced.has(item.type)).map(item => raw(bytes, item)) : [];
    const newIlst = box('ilst', ...kept, ...newItems(details));

    const metaParts = metaKids.map(kid => (kid === ilst ? newIlst : raw(bytes, kid)));
    if (!metaKids.some(kid => kid.type === 'hdlr')) {
        metaParts.unshift(box('hdlr', uint(0, 8), latin1('mdirappl'), uint(0, 9)));
    }
    if (!ilst) metaParts.push(newIlst);
    const newMeta = box('meta', prefix, ...metaParts);

    const parts = kids.map(kid => (kid === meta ? newMeta : raw(bytes, kid)));
    if (!meta) parts.push(newMeta);
    return box('udta', ...parts);
}

/** Move chunk offsets at or past `from` by `delta`; false when one no longer fits. */
function shiftChunkOffsets(moov, from, delta) {
    const tables = [];
    const walk = (item, path) => contents(moov, item).forEach(child => {
        if (path.length) {
            if (child.type === path[0]) walk(child, path.slice(1));
        } else if (child.type === 'stco' || child.type === 'co64') {
            tables.push(child);
        }
    });
    walk({ start: 0, end: moov.length, header: 8 }, ['trak', 'mdia', 'minf', 'stbl']);

    for (const table of tables) {
        const size = table.type === 'stco' ? 4 : 8;
        const start = table.start + table.header + 8;
        const count = readUint(moov, start - 4, 4);
        for (let i = 0; i < count; i++) {
            const at = start + i * size;
            const offset = readUint(moov, at, size);
            if (offset < from) continue;
            const moved = offset + delta;
            if (size === 4 && moved > 0xFFFFFFFF) return false;
            moov.set(uint(moved, size), at);
        }
    }
    return true;
}

export function matches(head) {
    return !!brands(head) || QUICKTIME_TYPES.has(ascii(head, 4, 4));
}

export async function embed(blob, details) {
    const top = await scanBoxes(blob);
    // Fragmented files point at their own fragments; leave those alone.
    if (top.some(item => item.type === 'moof')) return null;
    const moov = top.find(item => item.type === 'moov');
    if (!moov) return null;

    const bytes = await readBytes(blob, moov.start, moov.end);
    const local = { ...moov, start: 0, end: bytes.length };
    const kids = contents(bytes, local);
    const udta = kids.find(kid => kid.type === 'udta');
    const newUdta = rebuildUserData(bytes, udta, details);
    if (!newUdta) return null;

    const parts = kids.map(kid => (kid === udta ? newUdta : raw(bytes, kid)));
    if (!udta) parts.push(newUdta);
    const newMoov = box('moov', ...parts);
    if (!shiftChunkOffsets(newMoov, moov.end, newMoov.length - bytes.length)) return null;
    return new Blob([blob.slice(0, moov.start), newMoov, blob.slice(moov.end)], { type: blob.type });
}
