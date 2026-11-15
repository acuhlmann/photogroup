// Small messages that fit a nearby channel when the network is weak: a
// person's name, a star rating for a photo, and the list of photos that a
// phone has. Sound carries about 10 bytes per second, so each of them is a
// few bytes. The same bytes go over a direct link (see directLink.js).
//
// A frame is: "N", version, the room's mark (2 bytes), the sender's mark
// (4 bytes), then the notes, each with one byte that says what it is.

const PREFIX = 'pg2:';
const MAGIC = 0x4e; // "N"
const VERSION = 1;
const HEADER = 8;
const NAME = 1;
const RATING = 2;
const HAVE = 3;
// A name in a note. Longer names lose their end.
export const NOTE_NAME_BYTES = 24;
// One frame as sound: about 8 seconds at the most.
export const SOUND_FRAME_BYTES = 64;

/** FNV-1a, 32 bits. Works without WebCrypto (a page on plain http has none). */
export function hash32(text) {
    let hash = 0x811c9dc5;
    const value = String(text);
    for (let i = 0; i < value.length; i++) {
        hash ^= value.charCodeAt(i);
        hash = Math.imul(hash, 0x01000193);
    }
    return hash >>> 0;
}

/** A 16-bit mark of a room. A note for a different room is not used. */
export function roomTag(room) {
    const hash = hash32('room:' + room);
    return (hash ^ (hash >>> 16)) & 0xffff;
}

/** A 32-bit mark of a room photo, from its id. */
export function photoMark(id) {
    return hash32('photo:' + id);
}

/**
 * A 32-bit mark of a person in the room, from the peer id. The start of a
 * peer id is the same for all phones (the client's name), so the end is used.
 */
export function peerMark(peerId) {
    const tail = String(peerId || '').slice(-8);
    return /^[0-9a-f]{8}$/i.test(tail) ? parseInt(tail, 16) >>> 0 : hash32('peer:' + peerId);
}

/** The start of a text that is at most `max` bytes as UTF-8, with no cut character. */
export function cutUtf8(text, max) {
    const encoder = new TextEncoder();
    let cut = String(text || '');
    while (encoder.encode(cut).length > max) cut = Array.from(cut).slice(0, -1).join('');
    return cut;
}

function noteBytes(note) {
    if (note.type === 'name') {
        const name = new TextEncoder().encode(cutUtf8(note.name, NOTE_NAME_BYTES));
        return name.length ? [NAME, name.length, ...name] : null;
    }
    if (note.type === 'rating') {
        const rating = Number(note.rating);
        if (!Number.isInteger(rating) || rating < -1 || rating > 5) return null;
        const mark = note.mark ?? photoMark(note.photo);
        return [RATING, mark >>> 24, (mark >>> 16) & 0xff, (mark >>> 8) & 0xff, mark & 0xff, rating + 1];
    }
    return null;
}

function header(room, from) {
    const tag = roomTag(room);
    return [MAGIC, VERSION << 4, tag >> 8, tag & 0xff, from >>> 24, (from >>> 16) & 0xff, (from >>> 8) & 0xff, from & 0xff];
}

/**
 * The frames for some notes. A list of photos is cut into as many frames
 * as it needs; the other notes go in whole.
 * @param {object} message
 * @param {string} message.room the room's id
 * @param {number} message.from the sender's mark, see peerMark()
 * @param {Array<{type:'name',name:string}|{type:'rating',photo:string,rating:number}|{type:'have',photos:string[]}>} message.notes
 * @param {number} [maxBytes] the most bytes in one frame
 * @returns {Uint8Array[]}
 */
export function encodeNotes({ room, from, notes }, maxBytes = SOUND_FRAME_BYTES) {
    const frames = [];
    let frame = header(room, from);
    const flush = () => {
        if (frame.length > HEADER) frames.push(Uint8Array.from(frame));
        frame = header(room, from);
    };
    const add = (bytes) => {
        if (frame.length + bytes.length > maxBytes) flush();
        frame.push(...bytes);
    };
    (notes || []).forEach((note) => {
        if (note.type === 'have') {
            const marks = (note.marks || (note.photos || []).map(photoMark));
            // Each part says how many photos the whole list has.
            const total = Math.min(marks.length, 0xffff);
            const perFrame = Math.max(1, Math.min(255, Math.floor((maxBytes - HEADER - 4) / 4)));
            for (let at = 0; at < Math.max(total, 1); at += perFrame) {
                const part = marks.slice(at, Math.min(at + perFrame, total));
                const bytes = [HAVE, total >> 8, total & 0xff, part.length];
                part.forEach(mark => bytes.push(mark >>> 24, (mark >>> 16) & 0xff, (mark >>> 8) & 0xff, mark & 0xff));
                add(bytes);
            }
            return;
        }
        const bytes = noteBytes(note);
        if (bytes) add(bytes);
    });
    flush();
    return frames;
}

/**
 * `{ roomTag, from, notes }` from one frame, or null when the bytes are
 * not a frame. Photos come back as marks: the reader knows its own photos.
 */
export function decodeNotes(bytes) {
    if (!bytes || bytes.length <= HEADER || bytes[0] !== MAGIC || bytes[1] >> 4 !== VERSION) return null;
    const u32 = at => ((bytes[at] << 24) | (bytes[at + 1] << 16) | (bytes[at + 2] << 8) | bytes[at + 3]) >>> 0;
    const notes = [];
    let at = HEADER;
    try {
        while (at < bytes.length) {
            const type = bytes[at++];
            if (type === NAME) {
                const length = bytes[at++];
                if (!length || at + length > bytes.length) return null;
                const name = new TextDecoder('utf-8', { fatal: true }).decode(bytes.subarray(at, at + length));
                at += length;
                notes.push({ type: 'name', name });
            } else if (type === RATING) {
                if (at + 5 > bytes.length || bytes[at + 4] > 6) return null;
                notes.push({ type: 'rating', mark: u32(at), rating: bytes[at + 4] - 1 });
                at += 5;
            } else if (type === HAVE) {
                if (at + 3 > bytes.length) return null;
                const total = (bytes[at] << 8) | bytes[at + 1];
                const count = bytes[at + 2];
                at += 3;
                if (at + count * 4 > bytes.length) return null;
                const marks = [];
                for (let i = 0; i < count; i++, at += 4) marks.push(u32(at));
                notes.push({ type: 'have', total, marks });
            } else {
                return null;
            }
        }
    } catch {
        return null;
    }
    return { roomTag: (bytes[2] << 8) | bytes[3], from: u32(4), notes };
}

/** A frame as text, for sound. */
export function notesText(bytes) {
    let binary = '';
    bytes.forEach((byte) => { binary += String.fromCharCode(byte); });
    return PREFIX + btoa(binary).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}

/** The frame in a text that was heard, or null when it is something else. */
export function parseNotesText(text) {
    const value = String(text || '');
    if (!value.startsWith(PREFIX) || !/^[A-Za-z0-9_-]+$/.test(value.slice(PREFIX.length))) return null;
    try {
        const binary = atob(value.slice(PREFIX.length).replace(/-/g, '+').replace(/_/g, '/'));
        return Uint8Array.from(binary, char => char.charCodeAt(0));
    } catch {
        return null;
    }
}
