// Title, description, rating, keywords and location anyone in the room can set for a photo.
// They live beside the file's own embedded metadata (the torrent's bytes
// can't change) and take precedence over it in every viewer.

export const MAX_TITLE_LENGTH = 200;
export const MAX_DESCRIPTION_LENGTH = 4000;
export const MAX_PLACE_LENGTH = 200;
export const MAX_KEYWORDS = 30;
export const MAX_KEYWORD_LENGTH = 50;

/** Keywords as trimmed, non-empty strings, without repeats (ignoring case); [] clears them. */
function parseKeywords(value) {
    if (!Array.isArray(value)) throw new PhotoDetailsError('keywords must be a list of strings');
    const seen = new Set();
    const keywords = [];
    for (const item of value) {
        if (typeof item !== 'string') throw new PhotoDetailsError('keywords must be a list of strings');
        const keyword = item.trim();
        if (!keyword || seen.has(keyword.toLowerCase())) continue;
        if (keyword.length > MAX_KEYWORD_LENGTH) {
            throw new PhotoDetailsError(`a keyword is longer than ${MAX_KEYWORD_LENGTH} characters`);
        }
        seen.add(keyword.toLowerCase());
        keywords.push(keyword);
    }
    if (keywords.length > MAX_KEYWORDS) throw new PhotoDetailsError(`more than ${MAX_KEYWORDS} keywords`);
    return keywords;
}

export class PhotoDetailsError extends Error {}

/**
 * A location is {lat, long, name?} in WGS-84 degrees, or null to hide the
 * one in the file. Coordinates are rounded to 6 decimals (~0.1 m).
 */
function parseLocation(value) {
    if (value === null) return null;
    if (typeof value !== 'object' || Array.isArray(value)) {
        throw new PhotoDetailsError('location must be {lat, long} or null');
    }
    const { lat, long, name } = value;
    if (typeof lat !== 'number' || !Number.isFinite(lat) || Math.abs(lat) > 90) {
        throw new PhotoDetailsError('location.lat must be a number from -90 to 90');
    }
    if (typeof long !== 'number' || !Number.isFinite(long) || Math.abs(long) > 180) {
        throw new PhotoDetailsError('location.long must be a number from -180 to 180');
    }
    const location = { lat: Math.round(lat * 1e6) / 1e6, long: Math.round(long * 1e6) / 1e6 };
    if (name !== undefined && name !== null && name !== '') {
        if (typeof name !== 'string') throw new PhotoDetailsError('location.name must be a string');
        const trimmed = name.trim();
        if (trimmed.length > MAX_PLACE_LENGTH) {
            throw new PhotoDetailsError(`location.name is longer than ${MAX_PLACE_LENGTH} characters`);
        }
        if (trimmed) location.name = trimmed;
    }
    return location;
}

/**
 * Validate the fields a client sent. Only the keys present are returned;
 * an empty string or rating 0 clears a field, rating -1 marks a reject,
 * and location null hides the file's own location.
 */
export function parseDetails(body) {
    const changes = {};
    if (body.title !== undefined) {
        if (typeof body.title !== 'string') throw new PhotoDetailsError('title must be a string');
        const title = body.title.trim();
        if (title.length > MAX_TITLE_LENGTH) throw new PhotoDetailsError(`title is longer than ${MAX_TITLE_LENGTH} characters`);
        changes.title = title;
    }
    if (body.description !== undefined) {
        if (typeof body.description !== 'string') throw new PhotoDetailsError('description must be a string');
        const description = body.description.trim();
        if (description.length > MAX_DESCRIPTION_LENGTH) {
            throw new PhotoDetailsError(`description is longer than ${MAX_DESCRIPTION_LENGTH} characters`);
        }
        changes.description = description;
    }
    if (body.rating !== undefined) {
        if (!Number.isInteger(body.rating) || body.rating < -1 || body.rating > 5) {
            throw new PhotoDetailsError('rating must be a whole number from -1 to 5');
        }
        changes.rating = body.rating;
    }
    if (body.keywords !== undefined) changes.keywords = parseKeywords(body.keywords);
    if (body.location !== undefined) changes.location = parseLocation(body.location);
    if (Object.keys(changes).length === 0) throw new PhotoDetailsError('nothing to change');
    return changes;
}

/** Merge validated changes into the photo and stamp who made them. */
export function applyDetails(photo, changes, editor, now = Date.now()) {
    photo.details = {
        ...(photo.details || {}),
        ...changes,
        editedBy: editor,
        editedAt: now,
    };
    return photo.details;
}
