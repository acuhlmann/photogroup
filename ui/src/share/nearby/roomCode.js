// The few bytes that cross a nearby channel (sound, an NFC tag): the room's
// id, and a private room's key. Photos never go this way: sound carries
// about 10 bytes per second.

const PREFIX = 'pg1:';
const ROOM = /^[A-Za-z0-9_-]{6,40}$/;
const KEY = /^[A-Za-z0-9_-]{43}$/;

/** The text to send for a room, or null when the id cannot be sent. */
export function roomCodeText({ room, key } = {}) {
    if (!ROOM.test(String(room || ''))) return null;
    return PREFIX + room + (key && KEY.test(key) ? '#' + key : '');
}

/** `{ room, key }` from a received text, or null when it is not a room code. */
export function parseRoomCode(text) {
    const value = String(text || '');
    if (!value.startsWith(PREFIX)) return null;
    const [room, key = '', ...rest] = value.slice(PREFIX.length).split('#');
    if (rest.length || !ROOM.test(room) || (key && !KEY.test(key))) return null;
    return { room, key: key || null };
}
