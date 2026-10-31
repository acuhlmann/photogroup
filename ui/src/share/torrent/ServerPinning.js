/**
 * ServerPinning - the holder's side of the server-copy fallback: leave a
 * temporary copy of a photo on the server, but only when someone needs one.
 * Photos should travel browser to browser; the server is the last resort.
 *
 * A copy is uploaded when:
 *  - someone asks for one (their transfer stalled; the server relays the
 *    request as `serverCopyRequestedAt`) and this device has the photo;
 *  - this page goes to the background while someone in the room still
 *    lacks a photo we have: a phone in another app is usually frozen soon,
 *    and then nobody can get it from us;
 *  - the room keeps copies for latecomers: right after sharing.
 *
 * Uploads run one at a time, in chunks the server lets us resume, so a
 * phone frozen midway carries on when it comes back. Whoever shared the
 * photo answers a request at once; others who have it wait a moment, so
 * usually only one device sends it.
 *
 * An upload cut off while this page is in front (flaky network, a server
 * hiccup) is tried again, waiting longer each time, until it lands or is
 * no longer needed. While uploads are under way this device is told so
 * (`serverCopyBackup` events), and told again once everything landed: the
 * moment it is safe to lock the phone.
 */
import Logger from 'js-logger';
import { holds, wantsPhoto } from './RoomPhotos';
import { MAX_PHOTO_BYTES, MAX_PHOTO_MB } from './ServerCopyLimits';

/** Whether a seeded file is a clip, which is worth a copy whatever the room keeps. */
export const isVideo = blob => (blob?.type || '').startsWith('video/');

export const HELPER_DELAY_MS = 3000;
export const HELPER_JITTER_MS = 2000;
export const RETRY_DELAYS_MS = [5000, 15000, 30000, 60000];

/** Why a copy is being left, in words for geek mode's transfer view. */
export const UPLOAD_WHY = {
    asked: 'a P2P download stopped and the receiver asked for a copy',
    'going to background': 'this page went to the background before all people had the photo',
    'keep copies': 'the room keeps server copies for people who join later',
    video: 'clips get a server copy, because often only this phone has them',
    resuming: 'continuing an upload that stopped',
    retrying: 'trying again after an upload stopped',
};

export default class ServerPinning {
    /**
     * @param {object} deps
     * @param {object} deps.service RoomsService: uploadServerCopy(infoHash, blob, opts)
     * @param {RoomPhotos} deps.roomPhotos
     * @param {() => object[]} deps.getPeers room members (with `away`)
     * @param {() => string} deps.getMyPeerId
     * @param {(infoHash: string) => Promise<Blob|null>} deps.findBytes the photo as the torrent carries it
     */
    constructor({ service, roomPhotos, getPeers, getMyPeerId, findBytes, emitter, setTimer = (fn, ms) => setTimeout(fn, ms), random = Math.random } = {}) {
        Object.assign(this, { service, roomPhotos, getPeers, getMyPeerId, findBytes, setTimer, random, emitter });
        this.keepCopies = false;
        this.localFiles = new Map(); // infoHash -> what we seeded
        this.queue = [];
        this.queued = new Set();
        this.running = null;
        this.waiting = new Map(); // infoHash -> helper delay timer
        this.done = new Set(); // uploaded or turned down; don't retry
        this.interrupted = new Set(); // cut off by a freeze or lost network
        this.retries = new Map(); // infoHash -> failed attempts in a row
        this.pending = new Set(); // ours to land: queued, running or due a retry
        this.landed = 0; // copies stored since nothing was pending
        this.failed = 0; // copies we gave up on meanwhile
        this.hidden = false;
        emitter?.on?.('photos', event => this.onPhotos(event));
        emitter?.on?.('roomSettings', settings => this.setSettings(settings));
    }

    /**
     * Say where an upload stands (`serverCopy` events): queued, uploading
     * (with bytes), stored, exists, busy, interrupted, failed or too-large.
     */
    stage(infoHash, stage, extra = {}) {
        const photo = this.roomPhotos?.get?.(infoHash);
        this.emitter?.emit?.('serverCopy', {
            infoHash, direction: 'up', stage, name: photo?.fileName, ...extra,
        });
    }

    get myPeerId() {
        return this.getMyPeerId?.();
    }

    setSettings(settings) {
        this.keepCopies = !!settings?.keepCopies;
    }

    /** We just shared these (`{infoHash, blob}` of what was seeded). */
    shared(items) {
        items.forEach(({ infoHash, blob }) => {
            if (!infoHash || !blob) return;
            this.localFiles.set(infoHash, blob);
            // A clip is the photo most easily lost: the device that shared it
            // is often its only holder, and a browser under storage pressure
            // frees video pieces before images. So video gets a copy even in a
            // room that does not keep copies of everything. One too large for
            // the relay is declined by upload(), as it is for any photo.
            if (this.keepCopies) this.enqueue(infoHash, 'keep copies');
            else if (isVideo(blob)) this.enqueue(infoHash, 'video');
        });
        // Too large for a server copy: only this device has it until someone else does.
        const big = items.filter(({ blob }) => blob && blob.size > MAX_PHOTO_BYTES);
        if (big.length) {
            const what = big.length === 1 ? (isVideo(big[0].blob) ? 'This clip is' : 'This file is') : `${big.length} files are`;
            this.emitter?.emit?.('showInfo', `${what} larger than ${MAX_PHOTO_MB} MB, so it has no server copy. `
                + 'Keep PhotoGroup open until the others have it.');
        }
    }

    onPhotos({ type, item } = {}) {
        if (type === 'delete') {
            const infoHash = typeof item === 'string' ? item : item?.infoHash;
            this.localFiles.delete(infoHash);
            this.done.delete(infoHash);
            this.settle(infoHash);
            return;
        }
        if (type === 'addOwner') {
            // We have just said that we have a photo (after a refresh, from
            // the cache): answer a request that came before we said so.
            (Array.isArray(item) ? item : [item]).forEach(owner => {
                if (!owner?.infoHash || owner.peerId !== this.myPeerId || owner.loading) return;
                const photo = this.roomPhotos.get(owner.infoHash);
                if (photo?.serverCopyRequestedAt && !photo.hasServerCopy) this.answerRequest(owner.infoHash);
            });
            return;
        }
        if (type !== 'update' && type !== 'all') return;
        (Array.isArray(item) ? item : [item]).forEach(update => {
            if (!update?.infoHash) return;
            if (update.hasServerCopy === false && !update.serverCopyUploader) {
                // Dropped (everyone had it, or it expired): a new request may come.
                this.done.delete(update.infoHash);
            }
            // Someone else's copy landed: nothing left for us to send.
            if (update.hasServerCopy && !this.queued.has(update.infoHash)) this.settle(update.infoHash, 'landed');
            if (update.serverCopyRequestedAt && !update.hasServerCopy) this.answerRequest(update.infoHash);
        });
    }

    /** Someone in the room, other than us, wants the whole photo and doesn't have it. */
    someoneLacks(photo) {
        const me = this.myPeerId;
        return (this.getPeers?.() || []).some(peer => peer.peerId !== me && !holds(photo, peer.peerId) && wantsPhoto(photo, peer));
    }

    answerRequest(infoHash) {
        const photo = this.roomPhotos.get(infoHash);
        if (!photo || !holds(photo, this.myPeerId) || this.queued.has(infoHash) || this.waiting.has(infoHash)) return;
        // An old request (seen on rejoining) whose asker got it meanwhile.
        if (!this.someoneLacks(photo)) return;
        if (photo.peerId === this.myPeerId) {
            this.enqueue(infoHash, 'asked');
            return;
        }
        // Give whoever shared it a head start; join only if nobody has begun.
        const delay = HELPER_DELAY_MS + Math.round(this.random() * HELPER_JITTER_MS);
        this.waiting.set(infoHash, this.setTimer(() => {
            this.waiting.delete(infoHash);
            const now = this.roomPhotos.get(infoHash);
            // Nobody began, or whoever did went quiet (a phone frozen mid-upload).
            if (now && !now.hasServerCopy && !this.roomPhotos.uploadActive(infoHash)) this.enqueue(infoHash, 'asked');
        }, delay));
    }

    /**
     * Going to the background: copy every photo we have that someone in the
     * room still lacks, while this page can still run.
     */
    onHide() {
        this.hidden = true;
        const me = this.myPeerId;
        let count = 0;
        this.roomPhotos.all().forEach(photo => {
            if (photo.hasServerCopy || this.roomPhotos.uploadActive(photo.infoHash) || !holds(photo, me)) return;
            if (!this.someoneLacks(photo)) return;
            if (this.enqueue(photo.infoHash, 'going to background')) count++;
        });
        return count;
    }

    /** Back in front: carry on with anything a freeze interrupted. */
    onResume() {
        this.hidden = false;
        const interrupted = [...this.interrupted];
        this.interrupted.clear();
        interrupted.forEach(infoHash => this.carryOn(infoHash, 'resuming'));
        return this.pump();
    }

    enqueue(infoHash, reason) {
        if (this.queued.has(infoHash) || this.done.has(infoHash)) return false;
        const photo = this.roomPhotos.get(infoHash);
        if (photo?.hasServerCopy) return false;
        this.queued.add(infoHash);
        this.queue.push({ infoHash, reason });
        this.track(infoHash);
        this.stage(infoHash, 'queued', { reason, why: UPLOAD_WHY[reason] || reason });
        this.pump();
        return true;
    }

    pump() {
        if (this.running || this.queue.length === 0) return this.running;
        const job = this.queue.shift();
        this.running = this.upload(job)
            .catch(err => {
                Logger.warn('ServerPinning: ' + job.infoHash + ' ' + (err?.message || err));
                this.settle(job.infoHash, 'failed');
            })
            .finally(() => {
                this.running = null;
                this.queued.delete(job.infoHash);
                this.pump();
            });
        return this.running;
    }

    async upload({ infoHash, reason }) {
        const photo = this.roomPhotos.get(infoHash);
        if (photo?.hasServerCopy) return this.settle(infoHash, 'landed');
        const blob = this.localFiles.get(infoHash) || await this.findBytes?.(infoHash);
        if (!blob) {
            this.stage(infoHash, 'failed', { why: 'the bytes are no longer on this device' });
            return this.settle(infoHash, 'failed');
        }
        if (blob.size > MAX_PHOTO_BYTES) {
            this.done.add(infoHash);
            this.stage(infoHash, 'too-large', { total: blob.size, why: `over the ${MAX_PHOTO_MB} MB server limit, so P2P only` });
            Logger.info('ServerPinning: ' + infoHash + ' is too large to leave on the server');
            return this.settle(infoHash, 'failed');
        }
        Logger.info('ServerPinning: leaving a server copy of ' + (photo?.fileName || infoHash) + ' (' + reason + ')');
        const why = UPLOAD_WHY[reason] || reason;
        this.stage(infoHash, 'uploading', { reason, why, loaded: 0, total: blob.size });
        const result = await this.service.uploadServerCopy(infoHash, blob, {
            onProgress: (loaded, total) => this.stage(infoHash, 'uploading', { reason, why, loaded, total }),
        });
        this.stage(infoHash, result?.status === 'refused' ? 'failed' : (result?.status || 'failed'), {
            reason, why, loaded: result?.status === 'stored' ? blob.size : result?.received, total: blob.size,
        });
        // Cut off, or someone else is sending it: still not on the server.
        // Retrying takes over should their upload stall.
        if (result?.status === 'interrupted' || result?.status === 'busy') {
            if (this.hidden) this.interrupted.add(infoHash);
            else this.retryLater(infoHash);
            return;
        }
        // Stored, already there, or refused for good: don't send it again.
        this.done.add(infoHash);
        this.settle(infoHash, result?.status === 'stored' || result?.status === 'exists' ? 'landed' : 'failed');
    }

    /** Pick a cut-off upload up again, unless a copy landed meanwhile. */
    carryOn(infoHash, reason) {
        if (this.enqueue(infoHash, reason) || this.queued.has(infoHash)) return;
        this.settle(infoHash, this.roomPhotos.get(infoHash)?.hasServerCopy ? 'landed' : undefined);
    }

    /** Still in front: try again soon, then less and less often. */
    retryLater(infoHash) {
        const failures = this.retries.get(infoHash) || 0;
        this.retries.set(infoHash, failures + 1);
        const delay = RETRY_DELAYS_MS[Math.min(failures, RETRY_DELAYS_MS.length - 1)];
        Logger.info('ServerPinning: ' + infoHash + ' cut off, trying again in ' + Math.round(delay / 1000) + 's');
        this.setTimer(() => {
            if (!this.pending.has(infoHash)) return; // deleted or someone else's landed
            if (this.hidden) this.interrupted.add(infoHash);
            else this.carryOn(infoHash, 'retrying');
        }, delay);
    }

    track(infoHash) {
        if (this.pending.has(infoHash)) return;
        this.pending.add(infoHash);
        this.report();
    }

    /** Nothing more for us to send of this photo: `'landed'`, `'failed'`, or neither (deleted). */
    settle(infoHash, outcome) {
        this.retries.delete(infoHash);
        this.interrupted.delete(infoHash);
        if (!this.pending.delete(infoHash)) return;
        if (outcome === 'landed') this.landed++;
        if (outcome === 'failed') this.failed++;
        this.report();
    }

    /**
     * `{pending, landed, safe}`: how many copies are still on their way, how
     * many landed meanwhile, and whether all of it is now on the server:
     * not so if any copy was given up on.
     */
    report() {
        const pending = this.pending.size;
        const { landed, failed } = this;
        if (pending === 0) this.landed = this.failed = 0;
        this.emitter?.emit?.('serverCopyBackup', { pending, landed, safe: pending === 0 && landed > 0 && failed === 0 });
    }
}
