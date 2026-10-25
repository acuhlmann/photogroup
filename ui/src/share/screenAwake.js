import Logger from 'js-logger';
import { readPreference } from './preferences';
import { holds, wantsPhoto } from './torrent/RoomPhotos';

// Keep the screen on while photos are moving to or from this phone. A phone
// that sleeps stops sharing, and then the server has to step in. The lock
// is let go as soon as nothing is moving, and the browser drops it by
// itself when the page goes to the background.

export const CHECK_MS = 5000;

/**
 * True when this device still gets a photo that someone here has (or that
 * has a server copy), or has a photo that someone here, in front, lacks.
 * A photo only previewed under "Data saver" is not wanted, so not moving.
 */
export function photosMoving({ photos = [], peers = [], me, dataSaver = false }) {
    if (!me) return false;
    const present = peers.filter(peer => peer.peerId !== me && !peer.away);
    return photos.some(photo => {
        if (photo.isFake) return false;
        if (holds(photo, me)) return present.some(peer => !holds(photo, peer.peerId) && wantsPhoto(photo, peer));
        if (!wantsPhoto(photo, { peerId: me, dataSaver })) return false;
        return !!photo.hasServerCopy || present.some(peer => holds(photo, peer.peerId));
    });
}

export default class ScreenAwake {
    constructor({ master, nav = navigator, doc = document, checkMs = CHECK_MS } = {}) {
        Object.assign(this, { master, nav, doc, checkMs });
        this.lock = null;
        this.asking = false;
        this.check = this.check.bind(this);
    }

    start() {
        if (!this.nav?.wakeLock) return this;
        this.timer = setInterval(this.check, this.checkMs);
        this.doc.addEventListener('visibilitychange', this.check);
        return this;
    }

    stop() {
        this.stopped = true;
        clearInterval(this.timer);
        this.doc.removeEventListener?.('visibilitychange', this.check);
        this.release();
    }

    wanted() {
        const { master } = this;
        return !this.doc.hidden && photosMoving({
            photos: master.roomPhotos?.all?.() || [],
            peers: master.peers?.items || [],
            me: master.client?.peerId,
            dataSaver: readPreference('dataSaver'),
        });
    }

    async check() {
        if (this.wanted()) {
            if (this.lock || this.asking) return;
            this.asking = true;
            try {
                const lock = await this.nav.wakeLock.request('screen');
                // Stopped while the browser was still deciding: let go at once.
                if (this.stopped) {
                    lock.release?.().catch?.(() => {});
                    return;
                }
                lock.addEventListener?.('release', () => {
                    if (this.lock === lock) this.lock = null;
                });
                this.lock = lock;
            } catch (err) {
                // Low battery mode or no user gesture yet: try again next time.
                Logger.debug('wakeLock: ' + (err?.message || err));
            } finally {
                this.asking = false;
            }
        } else {
            this.release();
        }
    }

    release() {
        const lock = this.lock;
        this.lock = null;
        lock?.release?.().catch?.(() => {});
    }
}
