// How room codes moved between phones on this page: by sound, by camera, by
// NFC tag. Geek mode reads this list, also for pairings from before the map
// opened. Only real events go in.

const entries = [];
const MAX = 50;

/**
 * @param {object} emitter the room's emitter
 * @param {{channel: 'sound'|'qr'|'nfc', direction: 'in'|'out', bytes?: number, ms?: number, detail?: string}} entry
 */
export function notePairing(emitter, entry) {
    const noted = { at: Date.now(), ...entry };
    entries.push(noted);
    if (entries.length > MAX) entries.shift();
    emitter?.emit('pairing', noted);
    return noted;
}

export function pairings() {
    return entries.slice();
}

/** For tests. */
export function clearPairings() {
    entries.length = 0;
}

/**
 * A link from an NFC tag carries `via=nfc`. Note it and take it out of the
 * address, so a link sent on from here does not say "NFC".
 */
export function noteArrival(emitter, win = window) {
    const params = new URLSearchParams(win.location.search);
    if (params.get('via') !== 'nfc' || !params.has('room')) return;
    params.delete('via');
    win.history.replaceState({}, '', win.location.pathname + '?' + params.toString() + win.location.hash);
    notePairing(emitter, { channel: 'nfc', direction: 'in' });
}
