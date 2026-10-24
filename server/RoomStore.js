/**
 * RoomStore - rooms written to disk so they outlive the process.
 *
 * The server keeps rooms in memory, so a restart, an idle stop of the VM or a
 * crash emptied every room: the photos stayed on the devices that held them,
 * but the room that named them was gone, and a refresh left the sharer looking
 * at an empty room holding the only copy of a clip. Rooms and their photo
 * metadata are small JSON; the photos themselves never come here (they live on
 * the peers, and in the relay only while someone needs it), so writing the room
 * on change is cheap.
 *
 * What is *not* restored, on purpose:
 *  - peers: nobody is connected until they knock again;
 *  - photo owners: a peer id from before the restart means nothing now, and
 *    each device re-declares what it holds when it joins;
 *  - server copies: PhotoRelay wipes its scratch directory at startup, so a
 *    restored room must not claim a copy whose bytes were deleted.
 */
import fs from 'fs';
import fsp from 'fs/promises';
import path from 'path';

// A room nobody has touched in this long is gone from the file too.
export const ROOM_TTL_MS = 30 * 24 * 60 * 60 * 1000;
// Photos change in bursts (one PUT per render); one write per burst is enough.
export const WRITE_DEBOUNCE_MS = 500;

/** Where the file lives. Overridable so a container can mount a volume. */
export function defaultStorePath() {
    if (process.env.ROOM_STORE_PATH) return process.env.ROOM_STORE_PATH;
    const name = process.env.NODE_ENV === 'test' ? 'photogroup-rooms-test-' + process.pid + '.json' : 'rooms.json';
    return path.join(process.env.ROOM_STORE_DIR || path.join(process.cwd(), 'data'), name);
}

/**
 * The fields worth keeping of a photo. Copy state and owners are live facts,
 * not history, and both are stale the moment the process restarts.
 */
const SERVER_ONLY = new Set(['owners', 'hasServerCopy', 'serverCopySize', 'serverCopyReceived',
    'serverCopyRequestedAt', 'serverCopyUploader']);

export function serializablePhoto(photo) {
    const kept = {};
    Object.keys(photo || {}).forEach(key => {
        if (!SERVER_ONLY.has(key)) kept[key] = photo[key];
    });
    return kept;
}

export default class RoomStore {
    constructor({
        file = defaultStorePath(),
        now = () => Date.now(),
        ttlMs = ROOM_TTL_MS,
        debounceMs = WRITE_DEBOUNCE_MS,
        setTimer = (fn, ms) => setTimeout(fn, ms),
        clearTimer = handle => clearTimeout(handle),
    } = {}) {
        Object.assign(this, { file, now, ttlMs, debounceMs, setTimer, clearTimer });
        this.next = null;         // the rooms waiting to be written
        this.timer = null;
        this.writing = Promise.resolve();
        this.seq = 0;
    }

    /**
     * The rooms as they were left, newest first, dropping any nobody has
     * touched for `ttlMs`. A missing or unreadable file is simply no rooms:
     * a bad store must never stop the server from starting.
     */
    load() {
        let raw;
        try {
            raw = fs.readFileSync(this.file, 'utf8');
        } catch (err) {
            if (err.code !== 'ENOENT') console.warn('RoomStore: cannot read ' + this.file + ': ' + err.message);
            return [];
        }
        let parsed;
        try {
            parsed = JSON.parse(raw);
        } catch (err) {
            console.warn('RoomStore: ' + this.file + ' is not readable (' + err.message + '); starting with no rooms');
            return [];
        }
        const rooms = Array.isArray(parsed?.rooms) ? parsed.rooms : [];
        const at = this.now();
        return rooms
            .filter(room => room && typeof room.id === 'string' && Array.isArray(room.photos))
            .filter(room => at - (room.updatedAt || 0) <= this.ttlMs)
            .sort((a, b) => (b.updatedAt || 0) - (a.updatedAt || 0))
            .map(room => ({
                id: room.id,
                photos: room.photos.map(serializablePhoto),
                settings: room.settings || {},
                createdAt: room.createdAt || at,
                updatedAt: room.updatedAt || at,
            }));
    }

    /**
     * Queue a write of everything the server holds. Bursts collapse into one
     * write; nothing is thrown back at the caller, because a room the server
     * cannot persist is still a room the people in it are using.
     */
    schedule(rooms) {
        this.next = rooms;
        if (this.timer) return this.writing;
        this.timer = this.setTimer(() => {
            this.timer = null;
            this.flush().catch(err => console.warn('RoomStore: could not save rooms: ' + (err?.message || err)));
        }, this.debounceMs);
        return this.writing;
    }

    /** Write now, after any write already running. Resolves once it is on disk. */
    flush() {
        if (this.timer) { this.clearTimer(this.timer); this.timer = null; }
        // Nothing queued since the last write: writing again would only
        // rewrite, and a caller that never scheduled must not store an empty
        // room list over the real one.
        if (this.next === null) return this.writing;
        const rooms = this.next;
        this.next = null;
        // One write at a time: two renames of the same path would race, and
        // the second would find the file the first already moved away.
        const run = this.writing.then(() => this.write(rooms));
        this.writing = run.catch(() => {});
        return run;
    }

    async write(rooms) {
        const body = JSON.stringify({
            savedAt: this.now(),
            rooms: rooms.map(room => ({
                id: room.id,
                settings: room.settings || {},
                createdAt: room.createdAt,
                updatedAt: room.updatedAt || this.now(),
                photos: (room.photos || []).map(serializablePhoto),
            })),
        });
        // Write-then-rename, with a name of its own: a crash mid-write leaves
        // the previous file intact, and two stores cannot collide on one path.
        const tmp = `${this.file}.tmp.${process.pid}.${++this.seq}`;
        try {
            await fsp.mkdir(path.dirname(this.file), { recursive: true });
            await fsp.writeFile(tmp, body, 'utf8');
            await fsp.rename(tmp, this.file);
        } catch (err) {
            await fsp.rm(tmp, { force: true }).catch(() => {});
            throw err;
        }
    }

    /** Forget every room: used when the whole state is dropped by hand. */
    async clear() {
        if (this.timer) { this.clearTimer(this.timer); this.timer = null; }
        this.next = null;
        await this.writing;
        await fsp.rm(this.file, { force: true });
    }
}
