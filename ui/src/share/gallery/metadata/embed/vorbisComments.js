import { concat, decodeUtf8, latin1, readUintLE, ratingFraction, uintLE, utf8 } from './binary';

// Vorbis comments ("TITLE=...") as FLAC, Ogg Vorbis and Opus store them:
// a length-prefixed vendor string, a count, then length-prefixed entries.

const FIELDS = { title: ['TITLE'], description: ['DESCRIPTION', 'COMMENT'], rating: ['RATING'] };

/** {vendor, comments, end} from bytes at `offset`. */
export function parseComments(data, offset = 0) {
    const vendorLength = readUintLE(data, offset, 4);
    const vendor = data.subarray(offset + 4, offset + 4 + vendorLength);
    let at = offset + 4 + vendorLength;
    const count = readUintLE(data, at, 4);
    at += 4;
    const comments = [];
    for (let i = 0; i < count && at + 4 <= data.length; i++) {
        const length = readUintLE(data, at, 4);
        comments.push(decodeUtf8(data.subarray(at + 4, at + 4 + length)));
        at += 4 + length;
    }
    return { vendor, comments, end: at };
}

/** The comments with the shared details applied; cleared fields are dropped, not written empty. */
export function applyDetails(comments, details) {
    const replaced = Object.keys(FIELDS).filter(key => details[key] !== undefined).flatMap(key => FIELDS[key]);
    const kept = comments.filter(comment => !replaced.includes(comment.split('=')[0].toUpperCase()));
    if (details.title) kept.push('TITLE=' + details.title);
    if (details.description) kept.push('DESCRIPTION=' + details.description);
    const rating = ratingFraction(details.rating);
    // Winamp's 0..100 scale, which music-metadata reads back as stars.
    if (rating !== null) kept.push('RATING=' + Math.max(1, Math.round(rating * 100)));
    return kept;
}

export function buildComments(vendor, comments) {
    const entries = comments.map(utf8);
    return concat([uintLE(vendor.length, 4), vendor, uintLE(entries.length, 4),
        ...entries.flatMap(entry => [uintLE(entry.length, 4), entry])]);
}

export const DEFAULT_VENDOR = latin1('PhotoGroup');
