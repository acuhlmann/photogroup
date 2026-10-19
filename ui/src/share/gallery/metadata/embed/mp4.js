import { ascii, decodeUtf8, latin1, readBytes, readUint, ratingFraction, uint, utf8 } from './binary';
import { box, brands, parseBoxes, scanBoxes } from './isobmff';
import { isValidLocation, parseIso6709 } from '../geo';

// MP4, MOV and M4A keep tags as iTunes-style items under moov/udta/meta/ilst.
// Phones also record where a video was shot; see readLocation.
// Rewriting moov changes its size, so when the media data comes after it
// the chunk offset tables (stco/co64) are shifted to match.

const ITEMS = { title: '©nam', description: 'desc', rating: 'rate', keywords: 'keyw', location: '©xyz' };
const QUICKTIME_TYPES = new Set(['moov', 'mdat', 'wide', 'free', 'skip']);

function textItem(type, text) {
    return box(type, box('data', uint(1, 4), uint(0, 4), utf8(text)));
}

/** "+31.2400+121.4905/", the ISO 6709 form QuickTime uses. */
export function iso6709(location) {
    const part = (value, width) => (value < 0 ? '-' : '+') + Math.abs(value).toFixed(4).padStart(width, '0');
    return `${part(location.lat, 7)}${part(location.long, 8)}/`;
}

function newItems(details) {
    const items = [];
    if (details.title) items.push(textItem(ITEMS.title, details.title));
    if (details.description) items.push(textItem(ITEMS.description, details.description));
    const rating = ratingFraction(details.rating);
    if (rating !== null) items.push(textItem(ITEMS.rating, String(Math.max(1, Math.round(rating * 100)))));
    if (details.keywords && details.keywords.length) items.push(textItem(ITEMS.keywords, details.keywords.join(', ')));
    if (details.location) items.push(textItem(ITEMS.location, iso6709(details.location)));
    return items;
}

const contents = (bytes, item, skip = 0) => parseBoxes(bytes, item.start + item.header + skip, item.end);
const raw = (bytes, item) => bytes.subarray(item.start, item.end);

/** Children of a meta box, which is a full box in ISO files but not in QuickTime ones. */
function metaContents(bytes, meta) {
    const quickTime = ascii(bytes, meta.start + meta.header + 4, 4) === 'hdlr';
    return contents(bytes, meta, quickTime ? 0 : 4);
}

/** The value of an ilst item's data box as text. */
function itemText(bytes, item) {
    const data = contents(bytes, item).find(child => child.type === 'data');
    return data ? decodeUtf8(bytes.subarray(data.start + data.header + 8, data.end)) : null;
}

const LOCATION_KEY = 'com.apple.quicktime.location.ISO6709';
const MAX_MOOV = 64 * 1024 * 1024;

/** Location in a meta box: an iTunes ©xyz item, or Apple's keyed one. */
function locationInMeta(bytes, meta) {
    const kids = metaContents(bytes, meta);
    const ilst = kids.find(kid => kid.type === 'ilst');
    if (!ilst) return null;
    const items = contents(bytes, ilst);
    const xyz = items.find(item => item.type === '\u00A9xyz');
    if (xyz) return parseIso6709(itemText(bytes, xyz));
    const keys = kids.find(kid => kid.type === 'keys');
    if (!keys) return null;
    // keys: a full box, an entry count, then [size][namespace][name] entries;
    // ilst items are typed by their 1-based key index.
    const names = parseBoxes(bytes, keys.start + keys.header + 8, keys.end)
        .map(entry => decodeUtf8(bytes.subarray(entry.start + 8, entry.end)));
    const index = names.indexOf(LOCATION_KEY) + 1;
    const item = index && items.find(child => readUint(bytes, child.start + 4, 4) === index);
    return item ? parseIso6709(itemText(bytes, item)) : null;
}

/** 3GPP location box: name, role, then 16.16 fixed-point longitude, latitude, altitude. */
function locationInLoci(bytes, loci) {
    let at = loci.start + loci.header + 6; // full box, language
    if (bytes[at] === 0xFE && bytes[at + 1] === 0xFF) {
        while (at + 1 < loci.end && (bytes[at] || bytes[at + 1])) at += 2;
        at += 2;
    } else {
        while (at < loci.end && bytes[at]) at++;
        at += 1;
    }
    at += 1; // role
    if (at + 12 > loci.end) return null;
    const fixed = offset => ((bytes[offset] << 24) | (bytes[offset + 1] << 16) | (bytes[offset + 2] << 8) | bytes[offset + 3]) / 65536;
    const long = fixed(at);
    const lat = fixed(at + 4);
    const altitude = fixed(at + 8);
    if (!isValidLocation(lat, long)) return null;
    return altitude ? { lat, long, altitude } : { lat, long };
}

/**
 * Where a video was shot, as {lat, long, altitude?}, or null. Phones and
 * encoders use different places: QuickTime user data (udta/©xyz, Android),
 * 3GPP (udta/loci, ffmpeg's MP4), iTunes items (meta/ilst/©xyz) and Apple's
 * keyed metadata ("com.apple.quicktime.location.ISO6709", iPhone), the last
 * two in a meta box under either moov or udta.
 */
export async function readLocation(source) {
    const top = await scanBoxes(source);
    const moov = top.find(item => item.type === 'moov');
    if (!moov || moov.end - moov.start > MAX_MOOV) return null;
    const bytes = await readBytes(source, moov.start, moov.end);
    const kids = contents(bytes, { ...moov, start: 0, end: bytes.length });
    const udta = kids.find(kid => kid.type === 'udta');
    const candidates = [...(udta ? contents(bytes, udta) : []), ...kids.filter(kid => kid.type === 'meta')];

    for (const item of candidates) {
        let found = null;
        if (item.type === '\u00A9xyz') {
            const at = item.start + item.header;
            found = parseIso6709(decodeUtf8(bytes.subarray(at + 4, at + 4 + readUint(bytes, at, 2))));
        } else if (item.type === 'loci') {
            found = locationInLoci(bytes, item);
        } else if (item.type === 'meta') {
            found = locationInMeta(bytes, item);
        }
        if (found) return found;
    }
    return null;
}

/** udta with the shared details merged into its ilst, or null when it uses another tag scheme. */
function rebuildUserData(bytes, udta, details) {
    const kids = udta ? contents(bytes, udta) : [];
    const meta = kids.find(kid => kid.type === 'meta');
    let prefix = [0, 0, 0, 0];
    let metaKids = [];
    if (meta) {
        const quickTime = ascii(bytes, meta.start + meta.header + 4, 4) === 'hdlr';
        prefix = quickTime ? [] : bytes.subarray(meta.start + meta.header, meta.start + meta.header + 4);
        metaKids = metaContents(bytes, meta);
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

    // A location set in the room replaces the camera's own udta records of it.
    const stale = new Set(details.location !== undefined ? ['\u00A9xyz', 'loci'] : []);
    const parts = kids.filter(kid => !stale.has(kid.type)).map(kid => (kid === meta ? newMeta : raw(bytes, kid)));
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
