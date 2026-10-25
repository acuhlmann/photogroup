import { format } from 'date-fns';

// The rooms this browser opened, newest first, so people can go back to one
// from the front page. Kept in localStorage: it is a list for this browser
// only, and the room itself stays on the server.
const KEY = 'photogroup.rooms';
const MAX = 12;

function read() {
    try {
        const list = JSON.parse(localStorage.getItem(KEY) || '[]');
        return Array.isArray(list) ? list.filter(entry => entry && typeof entry.id === 'string') : [];
    } catch {
        return [];
    }
}

function write(list) {
    try {
        localStorage.setItem(KEY, JSON.stringify(list.slice(0, MAX)));
    } catch {
        // Storage blocked: the list is empty next time.
    }
}

/** The rooms, opened last first. */
export function listRooms() {
    return read().sort((a, b) => (b.lastSeen || 0) - (a.lastSeen || 0));
}

export function findRoom(id) {
    return read().find(entry => entry.id === id) || null;
}

/** Note that this browser is in the room now. */
export function visitRoom(id, now = Date.now()) {
    if (!id) return;
    const entry = findRoom(id) || { id, firstSeen: now };
    write([{ ...entry, lastSeen: now }, ...read().filter(item => item.id !== id)]);
}

/** Keep the room's name, as the room has it; '' or none clears it. */
export function nameRoom(id, name, now = Date.now()) {
    if (!id) return;
    const list = read();
    let entry = list.find(item => item.id === id);
    if (!entry) {
        // The room's settings can come in before the visit is noted.
        entry = { id, firstSeen: now, lastSeen: now };
        list.unshift(entry);
    }
    if (name) entry.name = name;
    else delete entry.name;
    write(list);
}

/** Take the room off this browser's list. The room itself stays. */
export function forgetRoom(id) {
    write(read().filter(item => item.id !== id));
}

/** What to call a room: its name, else the day this browser first opened it. */
export function roomLabel(entry) {
    if (entry?.name) return entry.name;
    if (entry?.firstSeen) return 'Room from ' + format(entry.firstSeen, 'd MMM');
    return 'This room';
}
