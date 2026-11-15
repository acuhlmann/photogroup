import { isPrivateRoom } from '../../privateRoom';

/**
 * Whether this client can change the room's shared photo details. Not in a
 * private room: the server would get the titles and places in clear.
 */
export function canSaveDetails(master) {
    return !isPrivateRoom()
        && !!(master && master.service && typeof master.service.updateDetails === 'function');
}

/** What to tell someone whose change to a photo did not save. */
export function saveErrorText(err) {
    return err && err.status === 404
        ? 'The photo is not shared completely yet. Try again in a moment.'
        : (err && err.message) || 'Could not save. Try again.';
}

/**
 * Save changed shared fields (title, description, rating) and publish the
 * updated photo locally; the room hears it over SSE too. When the server
 * does not answer, the change is kept and shown on this device, and it goes
 * to the server later (nearby/nearbyNotes.js). Other errors propagate.
 */
export async function saveDetails(master, infoHash, fields) {
    let saved;
    try {
        saved = await master.service.updateDetails(infoHash, fields);
    } catch (err) {
        saved = master.nearbyNotes?.holdDetails(infoHash, fields, err);
        if (!saved) throw err;
    }
    master.emitter.emit('photos', { type: 'update', item: [saved] });
    return saved;
}
