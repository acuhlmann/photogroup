/**
 * DeviceTimes - how long each device in the room took to get its first photo
 * and all of them, as this device saw it happen: when a device joined, when
 * a photo appeared, and when the room heard that the device holds it (an
 * owner without `loading`). Kept from the moment the room loads, like the
 * TransferLedger, so geek mode can show it whenever it is opened.
 *
 * Devices and photos already there when this device first looked count from
 * that moment, since that is when this device could start. Holdings already
 * there have no time: we did not see them arrive.
 */
export default class DeviceTimes {
    constructor({ emitter, getPeers = () => [], getPhotos = () => [], getMyPeerId = () => null, now = () => Date.now() } = {}) {
        this.getPeers = getPeers;
        this.getPhotos = getPhotos;
        this.getMyPeerId = getMyPeerId;
        this.now = now;
        this.joinedAt = new Map(); // peerId -> first seen
        this.photoAt = new Map(); // infoHash -> first seen
        this.hadAt = new Map(); // peerId -> Map(infoHash -> at, or null when it was there before we looked)
        this.started = false;
        const later = () => Promise.resolve().then(() => this.sample());
        ['peers', 'photos', 'newTorrent'].forEach(name => emitter?.on?.(name, later));
    }

    /** Note who is here, which photos exist and who holds them, now. */
    sample() {
        const at = this.now();
        const first = !this.started;
        const myPeerId = this.getMyPeerId();
        const peers = this.getPeers() || [];
        const photos = this.getPhotos() || [];
        if (!peers.length && !photos.length) return;
        this.started = true;
        peers.forEach(peer => {
            if (!this.joinedAt.has(peer.peerId)) this.joinedAt.set(peer.peerId, at);
        });
        if (myPeerId && !this.joinedAt.has(myPeerId)) this.joinedAt.set(myPeerId, at);
        photos.forEach(photo => {
            if (!photo.infoHash) return;
            if (!this.photoAt.has(photo.infoHash)) this.photoAt.set(photo.infoHash, at);
            (photo.owners || []).forEach(owner => {
                if (owner.loading || owner.peerId === photo.peerId) return;
                const had = this.hadAt.get(owner.peerId) || new Map();
                if (!had.has(photo.infoHash)) had.set(photo.infoHash, first ? null : at);
                this.hadAt.set(owner.peerId, had);
            });
        });
    }

    /**
     * One row per device in the room.
     * firstMs / allMs: from when the device could start (it was here and a
     * photo for it was) to its first photo and to its last; null when not
     * there yet or not seen.
     */
    read() {
        const photos = this.getPhotos() || [];
        const now = this.now();
        return (this.getPeers() || []).map(peer => {
            const id = peer.peerId;
            const had = this.hadAt.get(id) || new Map();
            const wanted = photos.filter(photo => photo.infoHash && photo.peerId !== id
                && (!peer.dataSaver || (photo.owners || []).some(owner => owner.peerId === id)));
            const got = wanted.filter(photo => had.has(photo.infoHash) || (photo.owners || []).some(owner => owner.peerId === id && !owner.loading));
            const seen = wanted.map(photo => this.photoAt.get(photo.infoHash)).filter(Number.isFinite);
            const joined = this.joinedAt.get(id);
            const start = Number.isFinite(joined) && seen.length ? Math.max(joined, Math.min(...seen)) : null;
            const times = got.map(photo => had.get(photo.infoHash)).filter(Number.isFinite);
            const firstAt = times.length ? Math.min(...times) : null;
            const allAt = got.length === wanted.length && wanted.length && times.length === got.length ? Math.max(...times) : null;
            return {
                peerId: id,
                wanted: wanted.length,
                got: got.length,
                firstMs: start !== null && firstAt !== null ? Math.max(0, firstAt - start) : null,
                allMs: start !== null && allAt !== null ? Math.max(0, allAt - start) : null,
                waitingMs: start !== null && got.length < wanted.length ? Math.max(0, now - start) : null,
                before: got.length > 0 && !times.length,
            };
        });
    }

    /**
     * The share as a whole, once every device here has every photo meant
     * for it: from the first photo appearing to the last one landing.
     */
    summary() {
        const rows = this.read();
        const wanted = rows.reduce((sum, row) => sum + row.wanted, 0);
        const done = rows.length > 1 && wanted > 0 && rows.every(row => row.got === row.wanted);
        const photoTimes = [...this.photoAt.values()].filter(Number.isFinite);
        const hadTimes = [...this.hadAt.values()].flatMap(had => [...had.values()]).filter(Number.isFinite);
        const startedAt = photoTimes.length ? Math.min(...photoTimes) : null;
        const endedAt = done && hadTimes.length ? Math.max(...hadTimes) : null;
        return {
            done,
            devices: rows.length,
            photos: (this.getPhotos() || []).length,
            startedAt,
            endedAt,
            totalMs: startedAt !== null && endedAt !== null && endedAt >= startedAt ? endedAt - startedAt : null,
        };
    }
}
