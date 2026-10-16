/**
 * ServerFallback - the third tier of the sharing strategy.
 *
 * P2P is tried first (fast, private). But two phones in the same café can
 * still fail to connect: carrier CGNAT, venue Wi-Fi client isolation, one
 * phone locking its screen. The uploader therefore also leaves a temporary
 * copy of each photo on the room server (see server/PhotoRelay.js). A
 * receiver whose torrent has made no progress for `stallMs` downloads that
 * copy over plain HTTPS instead of spinning forever - and caches it, so it
 * also survives a reload. P2P keeps running in the background either way.
 */
import Logger from 'js-logger';

export const P2P_STALL_MS = 10000;
export const FALLBACK_POLL_MS = 2000;

export function shouldUseServerFallback({ hasServerCopy, done, progress, startedAt, now, stallMs = P2P_STALL_MS }) {
    if (!hasServerCopy || done) return false;
    if ((progress || 0) >= 1) return false;
    if (!Number.isFinite(startedAt) || !Number.isFinite(now)) return false;
    return now - startedAt >= stallMs;
}

export default class ServerFallback {
    /**
     * @param {object} deps
     * @param {(infoHash:string)=>Promise<Blob|null>} deps.fetchCopy
     * @param {(infoHash:string, blob:Blob)=>Promise<void>} deps.cachePut
     * @param {object} deps.emitter emits 'torrentReady' with [photo] on success
     */
    constructor({ fetchCopy, cachePut, emitter, stallMs = P2P_STALL_MS, pollMs = FALLBACK_POLL_MS, now = () => Date.now() } = {}) {
        this.fetchCopy = fetchCopy;
        this.cachePut = cachePut;
        this.emitter = emitter;
        this.stallMs = stallMs;
        this.pollMs = pollMs;
        this.now = now;
        this.watched = new Map(); // infoHash -> {photo, getState, startedAt, timer, inFlight}
    }

    watch(photo, getState) {
        if (!photo?.infoHash || typeof this.fetchCopy !== 'function') return false;
        const existing = this.watched.get(photo.infoHash);
        if (existing) {
            existing.photo = photo; // pick up a later hasServerCopy flag
            return false;
        }
        const entry = { photo, getState, startedAt: this.now(), inFlight: false, timer: null };
        entry.timer = setInterval(() => this._check(photo.infoHash), this.pollMs);
        entry.timer?.unref?.();
        this.watched.set(photo.infoHash, entry);
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

    async _check(infoHash) {
        const entry = this.watched.get(infoHash);
        if (!entry || entry.inFlight) return;
        const state = entry.getState?.() || {};
        const due = shouldUseServerFallback({
            hasServerCopy: !!(entry.photo.hasServerCopy || state.hasServerCopy),
            done: state.done,
            progress: state.progress,
            startedAt: entry.startedAt,
            now: this.now(),
            stallMs: this.stallMs,
        });
        if (!due) {
            if (state.done || (state.progress || 0) >= 1) this.unwatch(infoHash);
            return;
        }
        entry.inFlight = true;
        try {
            const blob = await this.fetchCopy(entry.photo.infoHash);
            if (!blob) return;
            const photo = entry.photo;
            const file = typeof File !== 'undefined'
                ? new File([blob], photo.fileName || 'photo', { type: photo.fileType || blob.type })
                : blob;
            try { await this.cachePut?.(photo.infoHash, file); } catch { /* cache is best-effort */ }
            photo.fromCache = true;
            photo.fromServerCopy = true;
            photo.cachedFile = file;
            photo.file = file;
            photo.loading = false;
            Logger.info('ServerFallback: delivered ' + (photo.fileName || photo.infoHash) + ' via server copy');
            this.emitter?.emit('serverCopyReady', photo);
            this.emitter?.emit('torrentReady', [photo]);
            this.unwatch(infoHash);
        } catch (err) {
            Logger.warn('ServerFallback fetch failed for ' + infoHash + ': ' + (err?.message || err));
        } finally {
            const current = this.watched.get(infoHash);
            if (current) current.inFlight = false;
        }
    }
}
