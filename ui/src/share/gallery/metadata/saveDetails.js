/** Whether this client can change the room's shared photo details. */
export function canSaveDetails(master) {
    return !!(master && master.service && typeof master.service.updateDetails === 'function');
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
