/**
 * ConnectionRecovery - mobile browsers freeze pages aggressively: screen
 * lock, tab switch, Wi-Fi <-> cellular handover. When that happens the
 * tracker WebSocket, the SSE channel and every WebRTC peer silently die,
 * and nothing in the app used to notice. This helper:
 *
 *  - keeps the screen awake (Wake Lock) while a room is open, re-acquiring
 *    the lock whenever the page becomes visible again;
 *  - invokes `onResume` when the page returns to the foreground or the
 *    network comes back, so callers can re-announce to trackers, reopen
 *    SSE and re-sync room state.
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
    constructor({ onResume, target, navigatorObj, documentObj, wakeLock = true } = {}) {
        this.onResume = typeof onResume === 'function' ? onResume : () => {};
        this.target = target ?? (typeof window !== 'undefined' ? window : null);
        this.documentObj = documentObj ?? (typeof document !== 'undefined' ? document : null);
        this.navigatorObj = navigatorObj ?? (typeof navigator !== 'undefined' ? navigator : null);
        this.wakeLockEnabled = wakeLock;
        this.wakeLockSentinel = null;
        this.started = false;
        this._onVisibility = () => {
            if (this.documentObj && this.documentObj.visibilityState !== 'visible') return;
            this.requestWakeLock();
            this._resume('visible');
        };
        this._onOnline = () => this._resume('online');
    }

    start() {
        if (this.started || !this.target?.addEventListener) return;
        this.started = true;
        this.documentObj?.addEventListener?.('visibilitychange', this._onVisibility);
        this.target.addEventListener('online', this._onOnline);
        this.requestWakeLock();
    }

    stop() {
        if (!this.started) return;
        this.started = false;
        this.documentObj?.removeEventListener?.('visibilitychange', this._onVisibility);
        this.target?.removeEventListener?.('online', this._onOnline);
        this.releaseWakeLock();
    }

    _resume(reason) {
        try {
            this.onResume(reason);
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
