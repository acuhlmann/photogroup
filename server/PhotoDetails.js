// Title, description and rating anyone in the room can set for a photo.
// They live beside the file's own embedded metadata (the torrent's bytes
// can't change) and take precedence over it in every viewer.

export const MAX_TITLE_LENGTH = 200;
export const MAX_DESCRIPTION_LENGTH = 4000;

export class PhotoDetailsError extends Error {}

/**
 * Validate the fields a client sent. Only the keys present are returned;
 * an empty string or rating 0 clears a field, rating -1 marks a reject.
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
