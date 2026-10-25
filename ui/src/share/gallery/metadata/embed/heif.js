import { ascii, concat, decodeUtf8, latin1, readBytes, readUint, uint, utf8 } from './binary';
import { box, brands, parseBoxes, scanBoxes } from './isobmff';
import { applyDetailsToXmp } from './xmpPacket';
import { patchGps } from './exifGps';

// HEIC/AVIF keep Exif and XMP as items in the top-level meta box, XMP as
// an item of type "mime". When writing, the new packet is appended at the
// end of the file in its own mdat, and the item location (iloc) table is
// rewritten so the image data it points at still lines up after the meta
// box grows.

const HEIF_BRANDS = new Set(['mif1', 'msf1', 'miaf', 'heic', 'heix', 'heim', 'heis', 'hevc', 'hevx', 'avif', 'avis', 'avci']);
const XMP_TYPE = 'application/rdf+xml';

function cString(bytes, offset) {
    const end = bytes.indexOf(0, offset);
    return { text: decodeUtf8(bytes.subarray(offset, end < 0 ? bytes.length : end)), next: end < 0 ? bytes.length : end + 1 };
}

/** Exported for tests. */
export function parseItemInfo(bytes, iinf) {
    const start = iinf.start + iinf.header;
    const countSize = bytes[start] === 0 ? 2 : 4;
    return parseBoxes(bytes, start + 4 + countSize, iinf.end).filter(entry => entry.type === 'infe').map(entry => {
        const at = entry.start + entry.header;
        const version = bytes[at];
        if (version < 2) return { raw: bytes.subarray(entry.start, entry.end) };
        const idSize = version === 2 ? 2 : 4;
        const type = ascii(bytes, at + 4 + idSize + 2, 4);
        const name = cString(bytes, at + 4 + idSize + 6);
        return {
            id: readUint(bytes, at + 4, idSize),
            type,
            contentType: type === 'mime' ? cString(bytes, name.next).text : null,
            raw: bytes.subarray(entry.start, entry.end),
        };
    });
}

/** Exported for tests. */
export function parseLocations(bytes, iloc) {
    let at = iloc.start + iloc.header;
    const version = bytes[at];
    const table = {
        version,
        offsetSize: bytes[at + 4] >> 4,
        lengthSize: bytes[at + 4] & 0x0F,
        baseOffsetSize: bytes[at + 5] >> 4,
        indexSize: version > 0 ? bytes[at + 5] & 0x0F : 0,
        items: [],
    };
    const idSize = version < 2 ? 2 : 4;
    const count = readUint(bytes, at + 6, idSize);
    at += 6 + idSize;
    for (let i = 0; i < count; i++) {
        const item = { id: readUint(bytes, at, idSize), method: 0, extents: [] };
        at += idSize;
        if (version > 0) {
            item.method = bytes[at + 1] & 0x0F;
            at += 2;
        }
        item.dataRef = readUint(bytes, at, 2);
        item.base = readUint(bytes, at + 2, table.baseOffsetSize);
        at += 2 + table.baseOffsetSize;
        const extents = readUint(bytes, at, 2);
        at += 2;
        for (let e = 0; e < extents; e++) {
            const extent = { index: readUint(bytes, at, table.indexSize) };
            at += table.indexSize;
            extent.offset = readUint(bytes, at, table.offsetSize);
            at += table.offsetSize;
            extent.length = readUint(bytes, at, table.lengthSize);
            at += table.lengthSize;
            item.extents.push(extent);
        }
        table.items.push(item);
    }
    return table;
}

function writeLocations(table, offsetSize) {
    const { version, baseOffsetSize, indexSize } = table;
    const lengthSize = Math.max(table.lengthSize, 4);
    const idSize = version < 2 ? 2 : 4;
    const parts = [[version, 0, 0, 0], [(offsetSize << 4) | lengthSize, (baseOffsetSize << 4) | indexSize],
        uint(table.items.length, idSize)];
    table.items.forEach(item => {
        parts.push(uint(item.id, idSize));
        if (version > 0) parts.push(uint(item.method, 2));
        parts.push(uint(item.dataRef, 2), uint(item.base, baseOffsetSize), uint(item.extents.length, 2));
        item.extents.forEach(extent => {
            parts.push(uint(extent.index, indexSize), uint(extent.offset, offsetSize), uint(extent.length, lengthSize));
        });
    });
    return box('iloc', ...parts);
}

/** An item stored in this file or in the meta box's idat, as text or raw bytes. */
async function readItem(blob, bytes, kids, location, raw = false) {
    if (!location || location.dataRef !== 0) return null;
    let source;
    if (location.method === 0) {
        source = (start, end) => readBytes(blob, start, end);
    } else if (location.method === 1) {
        const idat = kids.find(kid => kid.type === 'idat');
        if (!idat) return null;
        const base = idat.start + idat.header;
        source = async (start, end) => bytes.subarray(base + start, base + end);
    } else {
        return null;
    }
    const parts = await Promise.all(location.extents.map(extent =>
        source(location.base + extent.offset, location.base + extent.offset + extent.length)));
    const data = concat(parts);
    return raw ? data : decodeUtf8(data);
}

/**
 * The Exif (as a TIFF block) and XMP items of a HEIF/AVIF file, read
 * directly because exifr 7 cannot parse many current HEIC files.
 */
export async function readMetadataItems(blob) {
    const top = await scanBoxes(blob);
    const meta = top.find(item => item.type === 'meta');
    if (!meta) return {};
    const bytes = await readBytes(blob, meta.start, meta.end);
    const kids = parseBoxes(bytes, meta.header + 4);
    const iinf = kids.find(kid => kid.type === 'iinf');
    const iloc = kids.find(kid => kid.type === 'iloc');
    if (!iinf || !iloc) return {};
    const infos = parseItemInfo(bytes, iinf);
    const table = parseLocations(bytes, iloc);
    const locate = info => table.items.find(item => item.id === info.id);

    const result = {};
    const exif = infos.find(info => info.type === 'Exif');
    if (exif) {
        const data = await readItem(blob, bytes, kids, locate(exif), true);
        // A 4-byte offset to the TIFF header comes first, usually past "Exif\0\0".
        if (data && data.length > 8) {
            const start = 4 + readUint(data, 0, 4);
            if (start < data.length) result.exif = data.subarray(start);
        }
    }
    const xmp = infos.find(info => info.type === 'mime' && info.contentType === XMP_TYPE);
    if (xmp) result.xmp = await readItem(blob, bytes, kids, locate(xmp));
    return result;
}

export function matches(head) {
    const list = brands(head);
    return !!list && list.some(brand => HEIF_BRANDS.has(brand));
}

export async function embed(blob, details) {
    const top = await scanBoxes(blob);
    // Image sequences carry track offsets as well; leave those alone.
    if (top.some(item => item.type === 'moov' || item.type === 'moof')) return null;
    const meta = top.find(item => item.type === 'meta');
    if (!meta) return null;

    const bytes = await readBytes(blob, meta.start, meta.end);
    const versionFlags = bytes.subarray(meta.header, meta.header + 4);
    const kids = parseBoxes(bytes, meta.header + 4);
    const find = type => kids.find(kid => kid.type === type);
    const [pitm, iinf, iloc, iref] = ['pitm', 'iinf', 'iloc', 'iref'].map(find);
    if (!pitm || !iinf || !iloc) return null;

    const primary = readUint(bytes, pitm.start + pitm.header + 4, bytes[pitm.start + pitm.header] === 0 ? 2 : 4);
    const infos = parseItemInfo(bytes, iinf);
    const table = parseLocations(bytes, iloc);
    // A zero length means "to the end of the file", which appending would change.
    if (table.items.some(item => item.method === 0 && item.extents.some(extent => extent.length === 0))) return null;

    const existing = infos.find(info => info.type === 'mime' && info.contentType === XMP_TYPE);
    const oldXml = existing ? await readItem(blob, bytes, kids, table.items.find(item => item.id === existing.id)) : null;
    const xmp = utf8(applyDetailsToXmp(oldXml, details));

    const ids = [...infos.map(info => info.id || 0), ...table.items.map(item => item.id)];
    const id = existing ? existing.id : Math.max(0, ...ids) + 1;
    if (table.version < 2 && id > 0xFFFF) return null;

    let newInfo = null;
    let newRef = null;
    if (!existing) {
        const idSize = id > 0xFFFF ? 4 : 2;
        newInfo = box('infe', [idSize === 2 ? 2 : 3, 0, 0, 0], uint(id, idSize), uint(0, 2),
            latin1('mime'), [0], latin1(XMP_TYPE), [0]);
        const refVersion = iref ? bytes[iref.start + iref.header] : 0;
        const refIdSize = refVersion === 0 ? 2 : 4;
        if (refVersion === 0 && (id > 0xFFFF || primary > 0xFFFF)) return null;
        newRef = box('cdsc', uint(id, refIdSize), uint(1, 2), uint(primary, refIdSize));
    }

    const metaEnd = meta.end;
    // Offset fields keep one width across both passes so the box size is stable.
    const offsetSize = blob.size + xmp.length + 0x100000 > 0xFFFFFFFF ? 8 : Math.max(table.offsetSize, 4);
    const location = { id, method: 0, dataRef: 0, base: 0, extents: [{ index: 0, offset: 0, length: xmp.length }] };
    const original = table.items.filter(item => item.id !== id);

    const build = delta => {
        // Data stored after the meta box moves by however much the box grew.
        const shifted = original.map(item => {
            if (item.method !== 0 || item.dataRef !== 0) return item;
            if (item.base > 0 && item.base >= metaEnd) return { ...item, base: item.base + delta };
            return {
                ...item,
                extents: item.extents.map(extent => (item.base + extent.offset >= metaEnd
                    ? { ...extent, offset: extent.offset + delta } : extent)),
            };
        });
        location.extents[0].offset = blob.size + delta + 8;
        const iinfStart = iinf.start + iinf.header;
        const iinfVersion = bytes[iinfStart];
        const countSize = iinfVersion === 0 ? 2 : 4;
        const entries = infos.map(info => info.raw).concat(newInfo ? [newInfo] : []);
        const newIinf = box('iinf', bytes.subarray(iinfStart, iinfStart + 4), uint(entries.length, countSize), ...entries);
        const newIloc = writeLocations({ ...table, items: [...shifted, location] }, offsetSize);
        const parts = kids.map(kid => {
            if (kid === iinf) return newIinf;
            if (kid === iloc) return newIloc;
            if (kid === iref && newRef) return box('iref', bytes.subarray(iref.start + iref.header, iref.end), newRef);
            return bytes.subarray(kid.start, kid.end);
        });
        if (!iref && newRef) parts.push(box('iref', [0, 0, 0, 0], newRef));
        return box('meta', versionFlags, ...parts);
    };

    const sized = build(0);
    const newMeta = build(sized.length - (meta.end - meta.start));
    return new Blob([blob.slice(0, meta.start), newMeta, blob.slice(meta.end), box('mdat', xmp)],
        { type: blob.type || 'image/heic' });
}

/**
 * A copy with the GPS position in the Exif item blanked in place, or null
 * when there is no Exif item with GPS fields in one piece to rewrite.
 * Only values change, so every offset in the file stays valid.
 */
export async function blankExifGps(blob) {
    const top = await scanBoxes(blob);
    const meta = top.find(item => item.type === 'meta');
    if (!meta) return null;
    const bytes = await readBytes(blob, meta.start, meta.end);
    const kids = parseBoxes(bytes, meta.header + 4);
    const iinf = kids.find(kid => kid.type === 'iinf');
    const iloc = kids.find(kid => kid.type === 'iloc');
    if (!iinf || !iloc) return null;
    const info = parseItemInfo(bytes, iinf).find(item => item.type === 'Exif');
    const location = info && parseLocations(bytes, iloc).items.find(item => item.id === info.id);
    if (!location || location.dataRef !== 0 || location.extents.length !== 1) return null;

    let at = location.base + location.extents[0].offset;
    if (location.method === 1) {
        const idat = kids.find(kid => kid.type === 'idat');
        if (!idat) return null;
        at += meta.start + idat.start + idat.header;
    } else if (location.method !== 0) {
        return null;
    }
    const data = await readBytes(blob, at, at + location.extents[0].length);
    if (data.length <= 8) return null;
    const start = 4 + readUint(data, 0, 4);
    if (start >= data.length) return null;
    const tiff = patchGps(data.subarray(start), null);
    if (!tiff) return null;
    return new Blob([blob.slice(0, at + start), tiff, blob.slice(at + start + tiff.length)], { type: blob.type || 'image/heic' });
}
