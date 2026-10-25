import { importRoomKey, keyFromHash, newRoomKey } from './security/roomKey';
import { findRoom } from './recentRooms';

// Is this room private, and does this page have its key? The key lives in
// the address after "#k=" and in this browser's room list, never on the server.

const PREFERENCE = 'encrypt';
export const PRIVATE_NO_KEY = 'This room is private. Open it with its full link or code to add and see photos.';
let markedPrivate = false;

/** The key in this page's address, or null. */
export function roomKeyText(win = window) {
    return keyFromHash(win.location.hash);
}

/** The CryptoKey for this room, or null without one. */
export function roomCryptoKey(win = window) {
    const text = roomKeyText(win);
    return text ? importRoomKey(text) : null;
}

/** The room says it is private (its settings), or this page has a key. */
export function isPrivateRoom(win = window) {
    return markedPrivate || !!roomKeyText(win);
}

/** Private, but this page has no key: nothing can be opened or added. */
export function missingRoomKey(win = window) {
    return markedPrivate && !roomKeyText(win);
}

export function markPrivate(value) {
    markedPrivate = !!value;
}

/** "#k=…" for a key, or '' for none. */
export function keyHash(key) {
    return key ? '#k=' + key : '';
}

export function setKeyInAddress(key, win = window) {
    const { pathname, search } = win.location;
    win.history.replaceState({}, '', pathname + search + keyHash(key));
}

/**
 * Before the app starts: a room opened from a link without its key (an old
 * tab, a share from another app) gets the key this browser kept for it.
 */
export function restoreRoomKey(win = window) {
    const room = new URLSearchParams(win.location.search).get('room');
    if (!room || roomKeyText(win)) return;
    const key = findRoom(room)?.key;
    if (key) setKeyInAddress(key, win);
}

/** The "Private room" switch next to "Start a room"; it stays as the person left it. */
export function wantsPrivateRooms() {
    try {
        return localStorage.getItem(PREFERENCE) === 'true';
    } catch {
        return false;
    }
}

export function setWantsPrivateRooms(value) {
    try {
        localStorage.setItem(PREFERENCE, String(!!value));
    } catch {
        // Storage blocked: the switch resets when the page reloads.
    }
}

/** A key for a new room when the person wants private rooms, else null. */
export function keyForNewRoom() {
    return wantsPrivateRooms() ? newRoomKey() : null;
}
