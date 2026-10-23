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
import { holds } from './RoomPhotos';
import { MAX_PHOTO_BYTES } from './ServerCopyLimits';

export const HELPER_DELAY_MS = 3000;
export const HELPER_JITTER_MS = 2000;
export const RETRY_DELAYS_MS = [5000, 15000, 30000, 60000];

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
        this.hidden = false;
        emitter?.on?.('photos', event => this.onPhotos(event));
        emitter?.on?.('roomSettings', settings => this.setSettings(settings));
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
            if (this.keepCopies) this.enqueue(infoHash, 'keep copies');
        });
    }

    onPhotos({ type, item } = {}) {
        if (type === 'delete') {
            const infoHash = typeof item === 'string' ? item : item?.infoHash;
            this.localFiles.delete(infoHash);
            this.done.delete(infoHash);
            this.settle(infoHash);
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
            if (update.hasServerCopy && !this.queued.has(update.infoHash)) this.settle(update.infoHash);
            if (update.serverCopyRequestedAt && !update.hasServerCopy) this.answerRequest(update.infoHash);
        });
    }

    /** Someone in the room, other than us, doesn't have the whole photo. */
    someoneLacks(photo) {
        const me = this.myPeerId;
        return (this.getPeers?.() || []).some(peer => peer.peerId !== me && !holds(photo, peer.peerId));
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
        this.pump();
        return true;
    }

    pump() {
        if (this.running || this.queue.length === 0) return this.running;
        const job = this.queue.shift();
        this.running = this.upload(job)
            .catch(err => {
                Logger.warn('ServerPinning: ' + job.infoHash + ' ' + (err?.message || err));
                this.settle(job.infoHash);
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
        if (photo?.hasServerCopy) return this.settle(infoHash);
        const blob = this.localFiles.get(infoHash) || await this.findBytes?.(infoHash);
        if (!blob) return this.settle(infoHash);
        if (blob.size > MAX_PHOTO_BYTES) {
            this.done.add(infoHash);
            Logger.info('ServerPinning: ' + infoHash + ' is too large to leave on the server');
            return this.settle(infoHash);
        }
        Logger.info('ServerPinning: leaving a server copy of ' + (photo?.fileName || infoHash) + ' (' + reason + ')');
        const result = await this.service.uploadServerCopy(infoHash, blob);
        if (result?.status === 'interrupted') {
            if (this.hidden) this.interrupted.add(infoHash);
            else this.retryLater(infoHash);
            return;
        }
        if (result?.status !== 'busy') {
            // Stored, already there, or refused for good: don't send it again.
            // Someone else uploading may stall, so a later request can retry.
            this.done.add(infoHash);
        }
        this.settle(infoHash, result?.status === 'stored' || result?.status === 'exists');
    }

    /** Pick a cut-off upload up again, unless a copy landed meanwhile. */
    carryOn(infoHash, reason) {
        if (!this.enqueue(infoHash, reason) && !this.queued.has(infoHash)) this.settle(infoHash);
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

    /** Nothing more for us to send of this photo, landed or not. */
    settle(infoHash, landed = false) {
        this.retries.delete(infoHash);
        this.interrupted.delete(infoHash);
        if (!this.pending.delete(infoHash)) return;
        if (landed) this.landed++;
        this.report();
    }

    /**
     * `{pending, landed, safe}`: how many copies are still on their way, how
     * many landed meanwhile, and whether all of it is now on the server.
     */
    report() {
        const pending = this.pending.size;
        const landed = this.landed;
        if (pending === 0) this.landed = 0;
        this.emitter?.emit?.('serverCopyBackup', { pending, landed, safe: pending === 0 && landed > 0 });
    }
}
