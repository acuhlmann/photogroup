/**
 * RoomPhotos - the room's photos as the server sees them: who shared each,
 * who has it (owners) and the state of its server copy. Built from the same
 * `photos` events the gallery renders, for code that decides about server
 * copies outside React (ServerPinning, ServerFallback).
 *
 * Local tiles flow through the same events with client-only fields and
 * placeholder hashes; only the fields below are kept.
 */
import { UPLOAD_LEASE_MS } from './ServerCopyLimits';

const TRACKED_FIELDS = ['peerId', 'fileName', 'fileType', 'secure', 'hasServerCopy', 'serverCopySize',
    'serverCopyReceived', 'serverCopyRequestedAt', 'serverCopyUploader',
    'serverCopyStartedAt', 'serverCopyStoredAt', 'serverCopyExpiresAt', 'serverCopyFrom'];

function pick(item) {
    const picked = { infoHash: item.infoHash };
    TRACKED_FIELDS.forEach(field => {
        if (field in item) picked[field] = item[field];
    });
    return picked;
}

const asList = item => (Array.isArray(item) ? item : [item]).filter(Boolean);

export default class RoomPhotos {
    constructor(emitter, { now = () => Date.now() } = {}) {
        this.photos = new Map();
        this.now = now;
        emitter?.on?.('photos', event => this.apply(event));
    }

    /**
     * Someone is uploading a copy and was heard from within the lease. Each
     * chunk is announced, so this goes by when we last heard, on our own
     * clock, not by the server's.
     */
    uploadActive(infoHash) {
        const photo = this.get(infoHash);
        return !!(photo?.serverCopyUploader && !photo.hasServerCopy
            && this.now() - (photo.serverCopyProgressAt || 0) < UPLOAD_LEASE_MS);
    }

    /** An upload was started but has gone quiet: someone else may take over. */
    uploadStalled(infoHash) {
        const photo = this.get(infoHash);
        return !!(photo?.serverCopyUploader && !photo.hasServerCopy && !this.uploadActive(infoHash));
    }

    get(infoHash) {
        return this.photos.get(infoHash) || null;
    }

    all() {
        return [...this.photos.values()];
    }

    _insert(item) {
        const photo = { ...pick(item), owners: (item.owners || []).map(owner => ({ ...owner })) };
        // Learned of an upload just now: give it a full lease.
        if (photo.serverCopyUploader) photo.serverCopyProgressAt = this.now();
        this.photos.set(item.infoHash, photo);
        return photo;
    }

    apply({ type, item } = {}) {
        switch (type) {
            case 'all': {
                // A snapshot can be older than news that arrived while it
                // was on its way: keep what it doesn't say, like the gallery.
                const before = this.photos;
                this.photos = new Map();
                asList(item).forEach(photo => {
                    if (!photo.infoHash) return;
                    const known = before.get(photo.infoHash);
                    const inserted = this._insert(photo);
                    if (known) {
                        TRACKED_FIELDS.forEach(field => {
                            if (inserted[field] === undefined && known[field] !== undefined) inserted[field] = known[field];
                        });
                        if (known.serverCopyProgressAt !== undefined) inserted.serverCopyProgressAt = known.serverCopyProgressAt;
                    }
                });
                break;
            }
            case 'add':
                asList(item).filter(photo => photo.infoHash && !photo.isFake && !this.photos.has(photo.infoHash))
                    .forEach(photo => this._insert(photo));
                break;
            case 'update':
                asList(item).forEach(update => {
                    if (!update.infoHash || update.isFake) return;
                    const known = this.photos.get(update.infoHash);
                    if (known) {
                        // A new chunk (or a new uploader), not a tile re-sent
                        // with the copy state it already had.
                        const progressed = ('serverCopyReceived' in update && update.serverCopyReceived !== known.serverCopyReceived)
                            || ('serverCopyUploader' in update && update.serverCopyUploader !== known.serverCopyUploader);
                        Object.assign(known, pick(update));
                        if (progressed) known.serverCopyProgressAt = this.now();
                    } else if (update.peerId && update.url) {
                        // Our own share, confirmed by the server: others hear it
                        // as 'add', the sharer only as a local update.
                        this._insert({ ...update, owners: [] });
                    }
                });
                break;
            case 'delete': {
                const infoHash = typeof item === 'string' ? item : item?.infoHash;
                this.photos.delete(infoHash);
                break;
            }
            case 'addOwner':
                asList(item).forEach(owner => {
                    const photo = this.photos.get(owner.infoHash);
                    if (photo && !photo.owners.some(known => known.peerId === owner.peerId)) {
                        photo.owners.push({ ...owner });
                    }
                });
                break;
            case 'updateOwner':
                asList(item).forEach(owner => {
                    const known = this.photos.get(owner.infoHash)?.owners.find(entry => entry.peerId === owner.peerId);
                    if (known) Object.assign(known, owner);
                });
                break;
            case 'removeOwner':
                this.photos.forEach(photo => {
                    photo.owners = photo.owners.filter(owner => owner.peerId !== item);
                });
                break;
            default:
                break;
        }
    }
}

/**
 * Whether a peer wants the whole photo now. With "Data saver" on, a peer
 * gets only the preview until it asks for the photo, which makes it an owner.
 */
export function wantsPhoto(photo, peer) {
    return !peer?.dataSaver || (photo?.owners || []).some(owner => owner.peerId === peer.peerId);
}

/** Whether `peerId` has all of a photo: its sharer, or an owner done loading. */
export function holds(photo, peerId) {
    return !!photo && (photo.peerId === peerId
        || (photo.owners || []).some(owner => owner.peerId === peerId && !owner.loading));
}
