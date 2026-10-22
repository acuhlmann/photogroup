/**
 * ConnectionRecovery - mobile browsers freeze pages aggressively: screen
 * lock, tab switch, Wi-Fi <-> cellular handover. When that happens the
 * tracker WebSocket, the SSE channel and every WebRTC peer silently die,
 * and nothing in the app used to notice. This helper:
 *
 *  - keeps the screen awake (Wake Lock) while a room is open, re-acquiring
 *    the lock whenever the page becomes visible again;
 *  - invokes `onHide` when the page goes to the background, the last moment
 *    a phone reliably runs our code (tell the room we're only away, leave a
 *    server copy for whoever still waits on our photos);
 *  - invokes `onResume(reason, {hiddenMs, networkChanged})` when the page
 *    returns to the foreground, comes back from the back/forward cache, is
 *    unfrozen, or the network comes back or changes, so callers can
 *    re-announce to trackers, reopen SSE and re-sync room state.
 *
 * Everything is feature-detected and injectable so it is safe (and
 * testable) outside a real browser.
 */
import Logger from 'js-logger';

export function backoffDelay(attempt, { baseMs = 1000, maxMs = 30000 } = {}) {
    const n = Math.max(0, Number.isFinite(attempt) ? attempt : 0);
    return Math.min(maxMs, baseMs * 2 ** n);
}

export default class ConnectionRecovery {
    constructor({ onResume, onHide, target, navigatorObj, documentObj, wakeLock = true, now = () => Date.now() } = {}) {
        this.onResume = typeof onResume === 'function' ? onResume : () => {};
        this.onHide = typeof onHide === 'function' ? onHide : () => {};
        this.target = target ?? (typeof window !== 'undefined' ? window : null);
        this.documentObj = documentObj ?? (typeof document !== 'undefined' ? document : null);
        this.navigatorObj = navigatorObj ?? (typeof navigator !== 'undefined' ? navigator : null);
        this.now = now;
        this.wakeLockEnabled = wakeLock;
        this.wakeLockSentinel = null;
        this.started = false;
        this.hiddenAt = null;
        this._onVisibility = () => {
            if (this.documentObj && this.documentObj.visibilityState === 'hidden') {
                this._hide();
                return;
            }
            this.requestWakeLock();
            this._resume('visible');
        };
        this._onOnline = () => this._resume('online', { networkChanged: true });
        this._onNetworkChange = () => this._resume('network', { networkChanged: true });
        // A page restored from the back/forward cache or unfrozen by Chrome's
        // Page Lifecycle never fires visibilitychange on the way back.
        this._onPageShow = event => { if (event?.persisted) this._resume('pageshow'); };
        this._onLifecycleResume = () => this._resume('resume');
    }

    get connection() {
        return this.navigatorObj?.connection;
    }

    start() {
        if (this.started || !this.target?.addEventListener) return;
        this.started = true;
        this.documentObj?.addEventListener?.('visibilitychange', this._onVisibility);
        this.documentObj?.addEventListener?.('resume', this._onLifecycleResume);
        this.target.addEventListener('online', this._onOnline);
        this.target.addEventListener('pageshow', this._onPageShow);
        this.connection?.addEventListener?.('change', this._onNetworkChange);
        this.requestWakeLock();
    }

    stop() {
        if (!this.started) return;
        this.started = false;
        this.documentObj?.removeEventListener?.('visibilitychange', this._onVisibility);
        this.documentObj?.removeEventListener?.('resume', this._onLifecycleResume);
        this.target?.removeEventListener?.('online', this._onOnline);
        this.target?.removeEventListener?.('pageshow', this._onPageShow);
        this.connection?.removeEventListener?.('change', this._onNetworkChange);
        this.releaseWakeLock();
    }

    _hide() {
        if (this.hiddenAt === null) this.hiddenAt = this.now();
        try {
            this.onHide();
        } catch (err) {
            Logger.warn('ConnectionRecovery onHide failed: ' + err);
        }
    }

    _resume(reason, { networkChanged = false } = {}) {
        // A background page that gets its network back may still serve
        // peers (Android keeps it running a while); anything else waits
        // until the page is visible.
        const hidden = !!this.documentObj && this.documentObj.visibilityState === 'hidden';
        if (hidden && !networkChanged) return;
        const hiddenMs = hidden || this.hiddenAt === null ? 0 : Math.max(0, this.now() - this.hiddenAt);
        if (!hidden) this.hiddenAt = null;
        try {
            this.onResume(reason, { hiddenMs, networkChanged });
        } catch (err) {
            Logger.warn('ConnectionRecovery onResume failed: ' + err);
        }
    }

    async requestWakeLock() {
        if (!this.wakeLockEnabled || !this.navigatorObj?.wakeLock?.request) return null;
        if (this.documentObj && this.documentObj.visibilityState === 'hidden') return null;
        try {
            this.wakeLockSentinel = await this.navigatorObj.wakeLock.request('screen');
            return this.wakeLockSentinel;
        } catch (err) {
            // NotAllowedError when not focused etc. - harmless, retried on visibility.
            Logger.debug('WakeLock unavailable: ' + (err?.message || err));
            return null;
        }
    }

    async releaseWakeLock() {
        try {
            await this.wakeLockSentinel?.release?.();
        } catch { /* already released */ }
        this.wakeLockSentinel = null;
    }
}
