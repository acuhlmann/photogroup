/**
 * TrackerKick - get back into the swarm as soon as a phone wakes up.
 *
 * Peers only find each other through the tracker WebSocket. When it drops
 * (screen lock, app switch, Wi-Fi <-> cellular), bittorrent-tracker waits
 * 10 s plus up to 5 minutes of random jitter before reconnecting, and a
 * socket that died while the page was frozen can still look open, so
 * announces go nowhere. Meanwhile the room sees us as gone.
 *
 * This reopens waiting trackers at once and, after a long sleep or a network
 * change, replaces even sockets that look healthy. Reopening announces with
 * fresh WebRTC offers, the same as the library's own (late) reconnect.
 *
 * All access to the library's private fields lives here. Written against
 * bittorrent-tracker 11.2.3, lib/client/websocket-tracker.js: a tracker
 * waiting to reconnect is `destroyed && reconnecting` with `reconnectTimer`
 * armed; `_openSocket()` reuses the pooled socket for its URL and, once
 * connected, announces if `reconnecting` is set.
 */
import Logger from 'js-logger';

/** After this long in the background, assume every tracker socket is dead. */
export const STALE_AFTER_HIDDEN_MS = 5000;
export const WATCHDOG_MS = 15000;
const MAX_WATCHDOG_BACKOFF_MS = 2 * 60 * 1000;

/** Every WebSocket tracker of every torrent. */
export function websocketTrackers(torrents) {
    const trackers = [];
    (torrents || []).forEach(torrent => {
        const list = torrent?.discovery?.tracker?._trackers;
        if (!Array.isArray(list)) return;
        list.forEach(tracker => {
            if (tracker && typeof tracker._openSocket === 'function') trackers.push(tracker);
        });
    });
    return trackers;
}

/** Waiting out the library's reconnect timer. */
export function isWaiting(tracker) {
    return !!(tracker.destroyed && tracker.reconnecting);
}

/**
 * Reopened onto a pooled socket that connected without telling it (see
 * `reopen`): announces are dropped while `reconnecting` is set.
 */
export function isStuck(tracker) {
    return !!(!tracker.destroyed && tracker.reconnecting && tracker.socket?.connected);
}

function reopen(tracker) {
    clearTimeout(tracker.reconnectTimer);
    tracker.reconnectTimer = null;
    // Makes the tracker announce (with fresh offers) once the socket connects.
    tracker.reconnecting = true;
    try {
        tracker._openSocket();
        // Only the tracker that created a pooled socket hears its 'connect';
        // one that joins it while still connecting would never announce and
        // stay `reconnecting` for good. `_onSocketConnect` is a no-op once
        // the tracker has announced, so a second call is harmless.
        const socket = tracker.socket;
        if (socket && !socket.connected && typeof socket.once === 'function') {
            socket.once('connect', () => {
                if (tracker.socket === socket) tracker._onSocketConnect();
            });
        }
        return true;
    } catch (err) {
        Logger.warn('TrackerKick reopen ' + tracker.announceUrl + ': ' + (err?.message || err));
        return false;
    }
}

/**
 * Reopen trackers. `stale` first drops live-looking sockets too. All are
 * dropped before any reopens: `_openSocket` would otherwise pick up the old
 * pooled socket another torrent still holds.
 */
export function kickTrackers(torrents, { stale = false, filter = () => true } = {}) {
    const trackers = websocketTrackers(torrents);
    if (stale) {
        trackers.filter(tracker => !tracker.destroyed).forEach(tracker => {
            try { tracker.destroy(); } catch { /* listeners are gone either way */ }
            tracker.reconnecting = true;
        });
    }
    let reopened = 0;
    trackers.filter(isStuck).forEach(tracker => {
        try { tracker._onSocketConnect(); reopened++; } catch { /* retried next time */ }
    });
    trackers.filter(isWaiting).filter(filter).forEach(tracker => {
        if (reopen(tracker)) reopened++;
    });
    return reopened;
}

export default class TrackerKick {
    constructor({ getTorrents, isVisible, now = () => Date.now(), watchdogMs = WATCHDOG_MS } = {}) {
        this.getTorrents = getTorrents || (() => []);
        this.isVisible = isVisible || (() => typeof document === 'undefined' || document.visibilityState !== 'hidden');
        this.now = now;
        this.watchdogMs = watchdogMs;
        this.timer = null;
        // tracker -> {attempts, nextAt}: a tracker that is simply down (public
        // ones come and go) shouldn't be retried every 15 s forever.
        this.backoff = new WeakMap();
    }

    /** On resume: reopen everything waiting; after a long sleep, everything. */
    kick({ hiddenMs = 0, networkChanged = false } = {}) {
        const stale = networkChanged || hiddenMs >= STALE_AFTER_HIDDEN_MS;
        this.backoff = new WeakMap();
        const reopened = kickTrackers(this.getTorrents(), { stale });
        if (reopened > 0) Logger.info('TrackerKick: reopened ' + reopened + ' tracker sockets' + (stale ? ' (stale)' : ''));
        return reopened;
    }

    /** Between resumes: don't leave a dropped tracker to the library's jitter. */
    tick() {
        if (!this.isVisible()) return 0;
        const now = this.now();
        const trackers = websocketTrackers(this.getTorrents());
        trackers.filter(tracker => !tracker.destroyed && !tracker.reconnecting)
            .forEach(tracker => this.backoff.delete(tracker));
        return kickTrackers(this.getTorrents(), {
            filter: tracker => {
                const state = this.backoff.get(tracker) || { attempts: 0, nextAt: 0 };
                if (now < state.nextAt) return false;
                const delay = Math.min(MAX_WATCHDOG_BACKOFF_MS, this.watchdogMs * 2 ** state.attempts);
                this.backoff.set(tracker, { attempts: state.attempts + 1, nextAt: now + delay });
                return true;
            }
        });
    }

    start() {
        if (this.timer) return;
        this.timer = setInterval(() => {
            try { this.tick(); } catch (err) { Logger.warn('TrackerKick tick: ' + err); }
        }, this.watchdogMs);
        this.timer?.unref?.();
    }

    stop() {
        clearInterval(this.timer);
        this.timer = null;
    }
}
