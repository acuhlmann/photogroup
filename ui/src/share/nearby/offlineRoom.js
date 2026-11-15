// A room with no server.
//
// While the server answers, this keeps a copy of what the room lists (its
// photos as the server describes them, and its settings) on this phone.
// When the server does not answer, a room opens from that copy, a new room
// starts empty, and photos that are added are kept here ("held"). Phones
// nearby learn of them over a direct link or by camera. When the server
// answers again, the held photos go to the room on the server.

import Logger from 'js-logger';
import ReopeningKvStore from '../util/ReopeningKvStore';
import { getBaseInfoHash } from '../torrent/WebTorrentUtils';
import { serverNotReached } from './nearbyNotes';
import { roomKeyText } from '../privateRoom';

const SAVE_MS = 500;
const PROBE_MS = 15000;
const MAX_LEARNED = 500;
// What a phone nearby may tell about a photo: text and numbers only.
const MAX_FIELD = 70000;

const promised = (store, method, ...args) => new Promise((resolve, reject) => {
    store[method](...args, (err, value) => (err ? reject(err) : resolve(value)));
});

function defaultStore() {
    if (typeof indexedDB === 'undefined') return null;
    try {
        return new ReopeningKvStore('room-snapshots');
    } catch {
        return null;
    }
}

/** A copy of a photo's description that has only what JSON carries. */
export function plainPhoto(photo) {
    try {
        const copy = JSON.parse(JSON.stringify(photo));
        delete copy.owners;
        return copy;
    } catch {
        return null;
    }
}

/** A description from another phone, or null when it is not one. */
export function checkedPhoto(item) {
    if (!item || typeof item !== 'object' || Array.isArray(item)) return null;
    if (typeof item.infoHash !== 'string' || !/^[0-9a-f]{40}(-.{1,300})?$/i.test(item.infoHash)) return null;
    if (typeof item.peerId !== 'string' || typeof item.url !== 'string' || !item.url.startsWith('magnet:')) return null;
    const photo = {};
    Object.entries(item).forEach(([key, value]) => {
        if (key === 'owners' || key.startsWith('serverCopy') || key === 'hasServerCopy') return;
        if (value === null || ['string', 'number', 'boolean'].includes(typeof value)) {
            if (typeof value !== 'string' || value.length <= MAX_FIELD) photo[key] = value;
        } else if (key === 'details' && typeof value === 'object' && JSON.stringify(value).length <= 4000) {
            photo[key] = value;
        }
    });
    if (typeof photo.poster === 'string' && !photo.poster.startsWith('data:image/jpeg;base64,')) delete photo.poster;
    return photo;
}

export default class OfflineRoom {
    /**
     * @param {object} master TorrentMaster
     * @param {object} [options]
     * @param {object|null} [options.store] a key-value store with get/set(key, value, callback)
     */
    constructor(master, { store = defaultStore(), probe = null, probeMs = PROBE_MS } = {}) {
        this.master = master;
        this.emitter = master.emitter;
        this.store = store;
        this.probe = probe || (() => fetch('/api/__trackerConfig__', { cache: 'no-store' }).then(response => response.ok));
        this.away = false;
        this.roomId = null;
        this.photos = new Map();
        this.held = new Set();
        this.settings = {};
        this.madeHere = false;
        this.saveTimer = null;
        this.returning = null;

        if (typeof window !== 'undefined') {
            window.addEventListener?.('online', () => { this.tryReturn().catch(() => {}); });
            window.addEventListener?.('offline', () => { this.check().catch(() => {}); });
        }
        this.timer = setInterval(() => { if (this.away) this.tryReturn().catch(() => {}); }, probeMs);
        this.timer?.unref?.();
    }

    get room() {
        return this.master.service?.id;
    }

    setAway(away) {
        if (this.away === away) return;
        this.away = away;
        Logger.info(away ? 'The server does not answer: the room works with phones nearby only' : 'The server answers again');
        this.emitter?.emit('serverAway', away);
    }

    /** A request to the server failed: when it was not reached, the room is on its own now. */
    failed(err) {
        if (serverNotReached(err) && this.master.service?.hasRoom) this.setAway(true);
    }

    /** Something says that the server may be away (the stream of news broke, the phone went offline): ask it. */
    async check() {
        if (this.away || !this.master.service?.hasRoom) return;
        const there = await Promise.resolve().then(() => this.probe()).catch(() => false);
        if (!there) this.setAway(true);
    }

    // The copy of the room that is open; another room has its own.
    async load() {
        if (this.roomId === this.room) return;
        this.roomId = this.room;
        this.photos = new Map();
        this.held = new Set();
        this.settings = {};
        this.madeHere = false;
        if (!this.store) return;
        try {
            const saved = await promised(this.store, 'get', this.roomId);
            // The room changed while the copy was read.
            if (this.roomId !== this.room || !saved || !Array.isArray(saved.photos)) return;
            saved.photos.forEach((photo) => { if (photo?.infoHash && !this.photos.has(photo.infoHash)) this.photos.set(photo.infoHash, photo); });
            (saved.held || []).forEach(id => this.held.add(id));
            this.settings = saved.settings || {};
            this.madeHere = !!saved.madeHere;
        } catch (err) {
            Logger.warn('Reading the copy of the room failed: ' + (err?.message || err));
        }
    }

    save() {
        if (!this.store || !this.roomId) return;
        clearTimeout(this.saveTimer);
        this.saveTimer = setTimeout(() => {
            const copy = { photos: [...this.photos.values()], held: [...this.held], settings: this.settings, madeHere: this.madeHere, savedAt: Date.now() };
            promised(this.store, 'set', this.roomId, copy)
                .catch(err => Logger.warn('Keeping a copy of the room failed: ' + (err?.message || err)));
        }, SAVE_MS);
    }

    /** What the room lists, for another phone. */
    descriptions() {
        return [...this.photos.values()];
    }

    describe(infoHash) {
        return this.photos.get(infoHash) || null;
    }

    /** The server's answer to a join: this is the room now. */
    async remember(room) {
        await this.load();
        this.photos = new Map();
        (room?.photos || []).forEach((photo) => {
            const plain = plainPhoto(photo);
            if (plain?.infoHash) this.photos.set(plain.infoHash, plain);
        });
        this.settings = room?.settings || {};
        this.save();
    }

    /** News from the server about the room's photos. */
    apply({ type, item } = {}) {
        if (this.roomId !== this.room) return;
        const list = (Array.isArray(item) ? item : [item]).filter(Boolean);
        if (type === 'add') {
            list.forEach((photo) => {
                const plain = plainPhoto(photo);
                if (plain?.infoHash && !this.photos.has(plain.infoHash)) this.photos.set(plain.infoHash, plain);
            });
        } else if (type === 'update') {
            list.forEach((update) => {
                const known = this.photos.get(update?.infoHash);
                const plain = known && plainPhoto(update);
                if (plain) Object.assign(known, plain);
            });
        } else if (type === 'delete') {
            const infoHash = typeof item === 'string' ? item : item?.infoHash;
            this.photos.delete(infoHash);
            this.held.delete(infoHash);
        } else {
            return;
        }
        this.save();
    }

    /** Photos that this phone added and the server did not get. */
    async hold(photos) {
        await this.load();
        photos.forEach((photo) => {
            const plain = plainPhoto(photo);
            if (!plain?.infoHash) return;
            plain.infoHash = decodeURIComponent(plain.infoHash);
            this.photos.set(plain.infoHash, { ...this.photos.get(plain.infoHash), ...plain });
            this.held.add(plain.infoHash);
        });
        this.save();
        this.setAway(true);
        this.emitter?.emit('offlinePhotos');
    }

    /** A photo's small picture that the server did not get. */
    holdPoster(infoHash, poster) {
        const known = this.photos.get(infoHash);
        if (!known || known.poster) return;
        known.poster = poster;
        this.save();
        this.emitter?.emit('photos', { type: 'update', item: [{ infoHash, poster }] });
        this.emitter?.emit('offlinePhotos');
    }

    /**
     * Photos that a phone nearby told about. The ones that are new here
     * join the room on this phone, and wait for the server like its own.
     * @returns {number} how many were new
     */
    learn(items) {
        if (this.roomId !== this.room) return 0;
        const fresh = [];
        (Array.isArray(items) ? items : []).slice(0, MAX_LEARNED).forEach((item) => {
            const photo = checkedPhoto(item);
            if (!photo) return;
            const known = this.photos.get(photo.infoHash);
            if (known) {
                // The small picture can come later than the photo's description.
                if (!known.poster && photo.poster && !known.secure) this.holdPoster(photo.infoHash, photo.poster);
                return;
            }
            if (this.master.roomPhotos?.get(photo.infoHash)) return;
            this.photos.set(photo.infoHash, photo);
            this.held.add(photo.infoHash);
            fresh.push(photo);
        });
        if (!fresh.length) return 0;
        this.save();
        // Photos that were shared together are one torrent: add them together.
        const groups = new Map();
        fresh.forEach((photo) => {
            const base = getBaseInfoHash(photo.infoHash);
            if (!groups.has(base)) groups.set(base, []);
            groups.get(base).push({ ...photo, owners: [] });
        });
        groups.forEach(group => this.emitter?.emit('photos', { type: 'add', item: group }));
        return fresh.length;
    }

    /** Open the room with no server: from the copy, or empty. */
    async openOffline({ create = false } = {}) {
        await this.load();
        if (create && !this.photos.size) this.madeHere = true;
        this.save();
        this.setAway(true);
        return {
            photos: this.descriptions().map(photo => ({ ...photo, owners: [] })),
            peers: [],
            connections: [],
            settings: this.settings,
            offline: true,
        };
    }

    /**
     * The server answered a join. Give it what was held, and return the
     * room with those photos in it.
     */
    async reconcile(room) {
        await this.load();
        const service = this.master.service;
        const listed = new Set((room?.photos || []).map(photo => photo.infoHash));
        const missing = [...this.held].map(id => this.photos.get(id)).filter(photo => photo && !listed.has(photo.infoHash));
        if (missing.length) {
            try {
                const posters = missing.filter(photo => photo.poster && !photo.secure);
                const shared = await service.sendShare(missing.map(photo => ({ ...photo })));
                room.photos = [...(shared || []), ...(room.photos || [])];
                Logger.info(`${missing.length} photo(s) that waited for the server are in the room now`);
                posters.forEach(photo => service.sharePoster(photo.infoHash, photo.poster).catch(() => {}));
            } catch (err) {
                // Still held: the next join tries again. Keep them on screen.
                Logger.warn('Giving the held photos to the server failed: ' + (err?.message || err));
                room.photos = [...missing.map(photo => ({ ...photo, owners: [] })), ...(room.photos || [])];
                await this.keepHeld(room);
                this.setAway(false);
                return room;
            }
        }
        this.held = new Set();
        if (this.madeHere) {
            this.madeHere = false;
            // A private room that started with no server: the server learns it now.
            if (roomKeyText()) {
                service.updateRoomSettings({ private: true })
                    .then(settings => this.emitter?.emit('roomSettings', settings))
                    .catch(err => Logger.warn('Making the room private on the server failed: ' + (err?.message || err)));
            }
        }
        await this.remember(room);
        this.setAway(false);
        return room;
    }

    async keepHeld(room) {
        const held = this.held;
        await this.remember(room);
        this.held = held;
        this.save();
    }

    /** Ask whether the server answers; when it does, join the room again. */
    tryReturn() {
        if (!this.away || !this.master.service?.hasRoom || !this.master.client) return Promise.resolve(false);
        if (!this.returning) {
            this.returning = (async () => {
                const there = await Promise.resolve().then(() => this.probe()).catch(() => false);
                if (!there || !this.away) return false;
                await this.master.findExistingContent(this.master.service.joinRoom);
                if (this.away) return false;
                this.master.nearbyNotes?.flush().catch(() => {});
                return true;
            })().catch((err) => {
                Logger.warn('Joining the room again failed: ' + (err?.message || err));
                return false;
            }).finally(() => { this.returning = null; });
        }
        return this.returning;
    }
}
