// Rewrite the GPS position inside an existing EXIF (TIFF) block in place.
// Only values are changed, never sizes or offsets, so it is safe on any
// file whose GPS fields already exist: notably photos whose position
// Android blanked to zeros. Files without those fields keep their EXIF as
// is and carry the location in XMP instead.

const GPS_IFD = 0x8825;
const LAT_REF = 1;
const LAT = 2;
const LONG_REF = 3;
const LONG = 4;
const ASCII = 2;
const RATIONAL = 5;

/** Degrees, minutes and seconds as [numerator, denominator] pairs; zeros over zero when hidden. */
function rationals(value) {
    if (value == null) return [[0, 0], [0, 0], [0, 0]];
    const abs = Math.abs(value);
    const degrees = Math.floor(abs);
    const minutes = Math.floor((abs - degrees) * 60);
    const seconds = Math.round(((abs - degrees) * 60 - minutes) * 60 * 10000);
    return [[degrees, 1], [minutes, 1], [seconds, 10000]];
}

/**
 * A copy of `tiff` with its GPS latitude/longitude set to `location`
 * ({lat, long}), or blanked when `location` is null. Returns null when the
 * block has no GPS fields of the expected shape to rewrite.
 */
export function patchGps(tiff, location) {
    const bytes = tiff.slice();
    const little = bytes[0] === 0x49 && bytes[1] === 0x49;
    if (!little && !(bytes[0] === 0x4D && bytes[1] === 0x4D)) return null;
    const u16 = at => (little ? bytes[at] | (bytes[at + 1] << 8) : (bytes[at] << 8) | bytes[at + 1]);
    const u32 = at => (little
        ? (bytes[at] | (bytes[at + 1] << 8) | (bytes[at + 2] << 16) | (bytes[at + 3] << 24)) >>> 0
        : ((bytes[at] << 24) | (bytes[at + 1] << 16) | (bytes[at + 2] << 8) | bytes[at + 3]) >>> 0);
    const put32 = (at, value) => {
        for (let i = 0; i < 4; i++) bytes[at + (little ? i : 3 - i)] = (value >>> (8 * i)) & 0xFF;
    };
    const entries = ifd => {
        if (ifd + 2 > bytes.length) return [];
        const list = [];
        for (let i = 0; i < u16(ifd); i++) {
            const at = ifd + 2 + i * 12;
            if (at + 12 > bytes.length) break;
            list.push({ tag: u16(at), type: u16(at + 2), count: u32(at + 4), at });
        }
        return list;
    };

    if (u16(2) !== 42) return null;
    const pointer = entries(u32(4)).find(entry => entry.tag === GPS_IFD);
    if (!pointer) return null;
    const gps = Object.fromEntries(entries(u32(pointer.at + 8)).map(entry => [entry.tag, entry]));

    const refOk = entry => entry && entry.type === ASCII && entry.count >= 1 && entry.count <= 4;
    const coordOk = entry => entry && entry.type === RATIONAL && entry.count === 3 && u32(entry.at + 8) + 24 <= bytes.length;
    if (![LAT_REF, LONG_REF].every(tag => refOk(gps[tag])) || ![LAT, LONG].every(tag => coordOk(gps[tag]))) return null;

    const writeRef = (entry, letter) => {
        bytes.fill(0, entry.at + 8, entry.at + 12);
        if (letter) bytes[entry.at + 8] = letter.charCodeAt(0);
    };
    const writeCoord = (entry, value) => {
        const offset = u32(entry.at + 8);
        rationals(value).forEach(([numerator, denominator], i) => {
            put32(offset + i * 8, numerator);
            put32(offset + i * 8 + 4, denominator);
        });
    };
    writeRef(gps[LAT_REF], location ? (location.lat < 0 ? 'S' : 'N') : null);
    writeRef(gps[LONG_REF], location ? (location.long < 0 ? 'W' : 'E') : null);
    writeCoord(gps[LAT], location ? location.lat : null);
    writeCoord(gps[LONG], location ? location.long : null);
    return bytes;
}
