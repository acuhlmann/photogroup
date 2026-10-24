/** Whether this client can change the room's shared photo details. */
export function canSaveDetails(master) {
    return !!(master && master.service && typeof master.service.updateDetails === 'function');
}

/** What to tell someone whose change to a photo did not save. */
export function saveErrorText(err) {
    return err && err.status === 404
        ? 'The photo is not shared completely yet. Try again in a moment.'
        : (err && err.message) || 'Could not save. Try again.';
}

/**
 * Save changed shared fields (title, description, rating) and publish the
 * updated photo locally; the room hears it over SSE too. Errors propagate.
 */
export async function saveDetails(master, infoHash, fields) {
    const saved = await master.service.updateDetails(infoHash, fields);
    master.emitter.emit('photos', { type: 'update', item: [saved] });
    return saved;
}
