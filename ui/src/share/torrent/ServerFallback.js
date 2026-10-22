/**
 * ServerFallback - the receiver's side of the last sharing tier.
 *
 * P2P is tried first (fast, private), TURN next. But two phones can still
 * fail to connect: carrier CGNAT, venue Wi-Fi client isolation, or the only
 * phone that has the photo is in another app. When a download has made no
 * progress for `stallMs`, this asks the room for a temporary server copy
 * (someone who has the photo uploads it, see ServerPinning) and, once one
 * exists, downloads it over plain HTTPS and caches it, so it also survives
 * a reload. When everyone who has the photo is away and a copy already
 * exists, it doesn't wait for the stall. P2P keeps running either way.
 */
import Logger from 'js-logger';
import { fingerprintFile } from '../gallery/fingerprint';

export const P2P_STALL_MS = 10000;
export const FALLBACK_POLL_MS = 2000;
// Ask again while still stuck: whoever has the photo may only now be back.
export const REREQUEST_MS = 60000;

export function shouldUseServerFallback({ hasServerCopy, done, progress, startedAt, lastProgressAt, now, stallMs = P2P_STALL_MS }) {
    if (!hasServerCopy || done) return false;
    return isTransferStalled({ done, progress, startedAt, lastProgressAt, now, stallMs });
}

/** For the UI: is this transfer actually stuck, vs. merely slow? */
export function isTransferStalled({ done, progress, lastProgressAt, startedAt, now, stallMs = P2P_STALL_MS }) {
    if (done || (progress || 0) >= 1) return false;
    // Stall is measured from the last progress, not from the start: a big
    // photo on a slow-but-working link can take minutes and must not be
    // "rescued" (and downloaded twice) just for being slow.
    const since = Number.isFinite(lastProgressAt) ? lastProgressAt : startedAt;
    if (!Number.isFinite(since) || !Number.isFinite(now)) return false;
    return now - since >= stallMs;
}

/**
 * Everyone who has the photo is in another app (and so likely frozen):
 * waiting for P2P is pointless. Unknown holders don't count.
 */
export function holdersAllAway({ holders, activeHolders }) {
    return Number.isFinite(holders) && holders > 0 && activeHolders === 0;
}

/**
 * Anyone who has a photo may leave its server copy: check it is the one its
 * sharer fingerprinted. Encrypted shares have no fingerprint (wrong bytes
 * just won't decrypt), and without WebCrypto (plain http) nothing can be
 * checked.
 */
export async function isSharedPhoto(photo, blob) {
    if (!photo?.fingerprint) return true;
    const fingerprint = await fingerprintFile(blob);
    return fingerprint === null || fingerprint === photo.fingerprint;
}

export default class ServerFallback {
    /**
     * @param {object} deps
     * @param {(infoHash:string)=>Promise<Blob|null>} deps.fetchCopy
     * @param {(infoHash:string)=>Promise<any>} deps.requestCopy ask the room for a copy
     * @param {(infoHash:string, blob:Blob)=>Promise<void>} deps.cachePut
     * @param {(photo:object, blob:Blob)=>Promise<boolean>} [deps.verify] whether
     *   the copy is the photo that was shared; anyone who has it may upload one
     * @param {object} deps.emitter emits 'torrentReady' with [photo] on success
     */
    constructor({ fetchCopy, requestCopy, cachePut, verify, emitter, stallMs = P2P_STALL_MS, pollMs = FALLBACK_POLL_MS,
        rerequestMs = REREQUEST_MS, now = () => Date.now() } = {}) {
        this.fetchCopy = fetchCopy;
        this.requestCopy = requestCopy;
        this.verify = verify;
        this.cachePut = cachePut;
        this.emitter = emitter;
        this.stallMs = stallMs;
        this.pollMs = pollMs;
        this.rerequestMs = rerequestMs;
        this.now = now;
        this.watched = new Map(); // infoHash -> {photo, getState, startedAt, lastProgressAt, requestedAt, timer, inFlight}
    }

    /**
     * Watch a download. `getState()` returns {progress, done} and, when
     * known, {hasServerCopy, holders, activeHolders}.
     */
    watch(photo, getState) {
        if (!photo?.infoHash || typeof this.fetchCopy !== 'function') return false;
        const existing = this.watched.get(photo.infoHash);
        if (existing) {
            this.update(photo);
            return false;
        }
        const entry = { photo, original: photo, getState, startedAt: this.now(), lastProgressAt: this.now(), lastProgress: 0, requestedAt: null, inFlight: false, timer: null };
        entry.timer = setInterval(() => this._check(photo.infoHash), this.pollMs);
        entry.timer?.unref?.();
        this.watched.set(photo.infoHash, entry);
        return true;
    }

    /** Merge news about a watched photo, e.g. its server copy appearing. */
    update(partial) {
        const entry = partial?.infoHash && this.watched.get(partial.infoHash);
        if (!entry) return false;
        entry.photo = { ...entry.photo, ...partial };
        return true;
    }

    unwatch(infoHash) {
        const entry = this.watched.get(infoHash);
        if (entry?.timer) clearInterval(entry.timer);
        this.watched.delete(infoHash);
    }

    stopAll() {
        [...this.watched.keys()].forEach(key => this.unwatch(key));
    }

    /**
     * The page was asleep: no transfer could make progress while frozen.
     * Give P2P a fresh stall window to reconnect before using the server,
     * then ask again if still stuck.
     */
    resetClocks() {
        const now = this.now();
        this.watched.forEach(entry => {
            entry.startedAt = now;
            entry.lastProgressAt = now;
            entry.requestedAt = null;
        });
    }

    /** User tapped "use server copy": fetch it, or ask for one now. */
    async fetchNow(infoHash) {
        const entry = this.watched.get(infoHash);
        if (!entry || entry.inFlight) return false;
        if (this._hasCopy(entry, entry.getState?.() || {})) return this._deliver(entry);
        return this._request(entry);
    }

    _hasCopy(entry, state) {
        // The room's current view wins: a copy can also go away again.
        return state.hasServerCopy !== undefined ? !!state.hasServerCopy : !!entry.photo.hasServerCopy;
    }

    async _check(infoHash) {
        const entry = this.watched.get(infoHash);
        if (!entry || entry.inFlight) return;
        const state = entry.getState?.() || {};
        if (state.done || (state.progress || 0) >= 1) {
            this.unwatch(infoHash);
            return;
        }
        const now = this.now();
        if ((state.progress || 0) > (entry.lastProgress || 0)) {
            entry.lastProgress = state.progress;
            entry.lastProgressAt = now;
        }
        const stalled = isTransferStalled({
            progress: state.progress, startedAt: entry.startedAt, lastProgressAt: entry.lastProgressAt,
            now, stallMs: this.stallMs,
        });
        const hasCopy = this._hasCopy(entry, state);
        // A copy that wasn't the photo: don't fetch it again every poll.
        const rejectedLately = entry.rejectedAt !== undefined && now - entry.rejectedAt < this.rerequestMs;
        if (hasCopy && !rejectedLately && (stalled || holdersAllAway(state))) return this._deliver(entry);
        if (!hasCopy && stalled && (entry.requestedAt === null || now - entry.requestedAt >= this.rerequestMs)) {
            return this._request(entry);
        }
    }

    async _request(entry) {
        if (typeof this.requestCopy !== 'function') return false;
        entry.requestedAt = this.now();
        try {
            await this.requestCopy(entry.photo.infoHash);
            Logger.info('ServerFallback: asked for a server copy of ' + (entry.photo.fileName || entry.photo.infoHash));
            return true;
        } catch (err) {
            Logger.warn('ServerFallback request failed for ' + entry.photo.infoHash + ': ' + (err?.message || err));
            return false;
        }
    }

    async _deliver(entry) {
        const infoHash = entry.photo.infoHash;
        entry.inFlight = true;
        try {
            const blob = await this.fetchCopy(infoHash);
            if (!blob) return false;
            if (this.verify && !(await this.verify(entry.photo, blob))) {
                entry.rejectedAt = this.now();
                Logger.warn('ServerFallback: server copy of ' + (entry.photo.fileName || infoHash) + " isn't the shared photo; ignored");
                return false;
            }
            // The gallery's photo object, so the tile it renders is updated.
            const photo = Object.assign(entry.original, entry.photo);
            const file = typeof File !== 'undefined'
                ? new File([blob], photo.fileName || 'photo', { type: photo.fileType || blob.type })
                : blob;
            try { await this.cachePut?.(infoHash, file); } catch { /* cache is best-effort */ }
            photo.fromCache = true;
            photo.fromServerCopy = true;
            photo.cachedFile = file;
            photo.file = file;
            photo.loading = false;
            Logger.info('ServerFallback: delivered ' + (photo.fileName || infoHash) + ' via server copy');
            this.emitter?.emit('serverCopyReady', photo);
            this.emitter?.emit('torrentReady', [photo]);
            this.unwatch(infoHash);
            return true;
        } catch (err) {
            Logger.warn('ServerFallback fetch failed for ' + infoHash + ': ' + (err?.message || err));
            return false;
        } finally {
            const current = this.watched.get(infoHash);
            if (current) current.inFlight = false;
        }
    }
}
