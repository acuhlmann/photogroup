// Names and photo details for when the server does not answer.
//
// A change that the server did not get is kept here ("held"), shown on this
// phone at once, and sent to the server when the connection is back. Until
// then the phones nearby can get it as a small note: over a direct link, or
// as sound (see notes.js). A phone that gets a note shows the change, but
// only the phone that made the change sends it to the server.

import Logger from 'js-logger';
import { decodeNotes, encodeNotes, peerMark, photoMark, roomTag, SOUND_FRAME_BYTES } from './notes';

export const HELD_TEXT = 'No connection to the server. Your change is kept. It goes to the room when the connection is back.';
const STORE = 'photogroup.held.';
const RETRY_MS = 30000;
// A list of photos that came in parts is one list when the parts are this near in time.
const HAVE_PARTS_MS = 60000;

/** Whether an error says that the server was not reached, not that it said no. */
export function serverNotReached(err) {
    // An answer with a status came from somewhere: only a gateway's "no server" counts.
    if (err && err.status !== undefined) return [502, 503, 504].includes(err.status);
    if (typeof navigator !== 'undefined' && navigator.onLine === false) return true;
    if (!err) return false;
    return err instanceof TypeError || /fetch|network/i.test(String(err.message || err));
}

export default class NearbyNotes {
    /**
     * @param {object} master TorrentMaster
     * @param {object} [options]
     * @param {Storage} [options.storage]
     */
    constructor(master, { storage = typeof localStorage === 'undefined' ? null : localStorage, now = () => Date.now() } = {}) {
        this.master = master;
        this.emitter = master.emitter;
        this.storage = storage;
        this.now = now;
        this.held = { name: null, details: {} };
        this.loadedFor = null;
        // What the phones nearby said: mark of the person -> { name, marks, total, at }.
        this.nearby = new Map();
        this.flushing = false;

        const retry = () => { this.flush().catch(() => {}); };
        this.emitter?.on?.('sseReconnected', retry);
        this.emitter?.on?.('readyToUpload', retry);
        if (typeof window !== 'undefined') window.addEventListener?.('online', retry);
        this.timer = setInterval(() => { if (this.count()) retry(); }, RETRY_MS);
        this.timer?.unref?.();
    }

    get room() {
        return this.master.service?.id;
    }

    // The held changes of the room that is open; another room has its own.
    load() {
        if (this.loadedFor === this.room) return;
        this.loadedFor = this.room;
        this.held = { name: null, details: {} };
        try {
            const saved = JSON.parse(this.storage?.getItem(STORE + this.room) || 'null');
            if (saved && typeof saved === 'object') {
                this.held = { name: typeof saved.name === 'string' ? saved.name : null, details: saved.details && typeof saved.details === 'object' ? saved.details : {} };
            }
        } catch { /* storage blocked or unreadable */ }
    }

    save() {
        try {
            if (this.count()) this.storage?.setItem(STORE + this.room, JSON.stringify(this.held));
            else this.storage?.removeItem(STORE + this.room);
        } catch { /* storage blocked or full */ }
        this.emitter?.emit('heldChanges', this.count());
    }

    /** How many changes wait for the server. */
    count() {
        this.load();
        return (this.held.name ? 1 : 0) + Object.keys(this.held.details).length;
    }

    /**
     * Keep a name that the server did not get.
     * @returns {boolean} false when the server said no: there is nothing to wait for
     */
    holdName(name, err) {
        if (!serverNotReached(err)) return false;
        this.load();
        this.held.name = name;
        this.save();
        this.master.offlineRoom?.failed(err);
        this.emitter?.emit('showInfo', HELD_TEXT);
        return true;
    }

    /**
     * Keep a change to a photo's details that the server did not get.
     * @returns {{infoHash: string, details: object}|null} the photo as this phone shows it now
     */
    holdDetails(infoHash, fields, err) {
        if (!serverNotReached(err)) return null;
        this.load();
        this.held.details[infoHash] = { ...(this.held.details[infoHash] || {}), ...fields };
        this.save();
        this.master.offlineRoom?.failed(err);
        this.emitter?.emit('showInfo', HELD_TEXT);
        return { infoHash, details: this.localDetails(infoHash, fields, this.me()) };
    }

    /** What waits for the server now: ask before a save, and give it to saved() after. */
    waiting(infoHash) {
        this.load();
        return infoHash ? this.held.details[infoHash] : this.held.name;
    }

    /**
     * The server took a newer change: the older one that waited must not
     * go to the server after it. A change that came while the server was
     * asked stays held.
     * @param {string|null} infoHash the photo, or null for the name
     * @param {*} before what waiting() gave before the save
     * @param {object} [fields] the photo's fields that the server took
     */
    saved(infoHash, before, fields = {}) {
        if (!before) return;
        this.load();
        if (!infoHash) {
            if (this.held.name !== before) return;
            this.held.name = null;
        } else {
            if (this.held.details[infoHash] !== before) return;
            const rest = Object.fromEntries(Object.entries(before).filter(([key]) => !(key in fields)));
            if (Object.keys(rest).length) this.held.details[infoHash] = rest;
            else delete this.held.details[infoHash];
        }
        this.save();
    }

    me() {
        const master = this.master;
        return { peerId: master.client?.peerId, name: master.me?.name || this.myName() || '', ...(master.device ? { device: master.device } : {}) };
    }

    myName() {
        try {
            return this.storage?.getItem('nickname') || '';
        } catch {
            return '';
        }
    }

    localDetails(infoHash, fields, editor) {
        return {
            ...(this.master.roomPhotos?.get(infoHash)?.details || {}),
            ...fields,
            editedBy: editor,
            editedAt: this.now(),
        };
    }

    /** Send the held changes to the server. Those that arrive are held no longer. */
    async flush() {
        if (this.flushing || !this.master.service?.hasRoom || !this.count()) return;
        this.flushing = true;
        const service = this.master.service;
        try {
            if (this.held.name) {
                const name = this.held.name;
                const peer = await service.updatePeer({ name }).catch(() => null);
                if (peer && this.held.name === name) this.held.name = null;
            }
            for (const [infoHash, fields] of Object.entries(this.held.details)) {
                try {
                    const saved = await service.updateDetails(infoHash, fields);
                    // A newer change to this photo may wait by now: it stays
                    // held, and it is what this phone shows.
                    if (this.held.details[infoHash] !== fields) continue;
                    delete this.held.details[infoHash];
                    this.emitter?.emit('photos', { type: 'update', item: [saved] });
                } catch (err) {
                    if (serverNotReached(err)) break;
                    // The server said no (the photo is gone, for example).
                    Logger.warn('A held change was not taken: ' + (err?.message || err));
                    if (this.held.details[infoHash] === fields) delete this.held.details[infoHash];
                }
            }
        } finally {
            this.flushing = false;
            this.save();
        }
    }

    /**
     * The notes of this phone: its name and the star ratings that wait for
     * the server. A rating is the one detail small enough for sound.
     * @param {string[]} [have] ids of the photos that this phone has, to add that list
     */
    myNotes(have = null) {
        this.load();
        const notes = [];
        const name = this.held.name || this.myName();
        if (name) notes.push({ type: 'name', name });
        Object.entries(this.held.details).forEach(([infoHash, fields]) => {
            if (Number.isInteger(fields.rating)) notes.push({ type: 'rating', photo: infoHash, rating: fields.rating });
        });
        if (have) notes.push({ type: 'have', photos: have });
        return notes;
    }

    /** The notes as frames, each small enough for the channel. */
    frames({ have = null, maxBytes = SOUND_FRAME_BYTES } = {}) {
        const from = peerMark(this.master.client?.peerId);
        return encodeNotes({ room: this.room, from, notes: this.myNotes(have) }, maxBytes);
    }

    /**
     * Use a frame that came from a phone nearby.
     * @returns {{own?: boolean, otherRoom?: boolean, from?: number, name?: string, names: number, ratings: number, have?: {count: number, total: number}}|null}
     */
    apply(bytes) {
        const frame = decodeNotes(bytes);
        if (!frame) return null;
        const master = this.master;
        if (frame.roomTag !== roomTag(this.room)) return { otherRoom: true, names: 0, ratings: 0 };
        if (frame.from === peerMark(master.client?.peerId)) return { own: true, names: 0, ratings: 0 };

        const peer = (master.peers?.items || []).find(item => peerMark(item.peerId) === frame.from) || null;
        let person = this.nearby.get(frame.from);
        if (!person) this.nearby.set(frame.from, person = { name: peer?.name || '', peerId: peer?.peerId || null, marks: new Set(), total: 0, at: 0 });
        if (peer) person.peerId = peer.peerId;
        const result = { from: frame.from, names: 0, ratings: 0 };

        frame.notes.forEach((note) => {
            if (note.type === 'name') {
                person.name = note.name;
                if (peer && peer.name !== note.name) {
                    this.emitter?.emit('peers', { type: 'update', item: { ...peer, name: note.name } });
                    result.names++;
                }
            } else if (note.type === 'rating') {
                const photo = (master.roomPhotos?.all() || []).find(item => photoMark(item.infoHash) === note.mark);
                // The same as what is shown: nothing to do.
                if (!photo || (photo.details?.rating || 0) === note.rating) return;
                const editor = { peerId: person.peerId || '', name: person.name || peer?.name || '' };
                this.emitter?.emit('photos', {
                    type: 'update',
                    item: [{ infoHash: photo.infoHash, details: this.localDetails(photo.infoHash, { rating: note.rating }, editor) }],
                });
                result.ratings++;
            } else if (note.type === 'have') {
                const at = this.now();
                if (at - person.at > HAVE_PARTS_MS || person.total !== note.total) person.marks = new Set();
                note.marks.forEach(mark => person.marks.add(mark));
                person.total = note.total;
                person.at = at;
                result.have = { count: person.marks.size, total: note.total };
            }
        });
        result.name = person.name || '';
        this.emitter?.emit('nearbyNotes', result);
        return result;
    }

    /** The names of the phones nearby that said they have this photo. */
    whoHas(infoHash) {
        const mark = photoMark(infoHash);
        return [...this.nearby.values()].filter(person => person.marks.has(mark)).map(person => person.name || 'A phone near you');
    }
}
