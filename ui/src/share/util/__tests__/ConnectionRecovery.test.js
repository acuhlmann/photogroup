import { describe, it, expect, vi } from 'vitest';
import ConnectionRecovery, { backoffDelay, freezesWhenHidden } from '../ConnectionRecovery';

describe('backoffDelay', () => {
    it('grows exponentially and caps', () => {
        expect(backoffDelay(0)).toBe(1000);
        expect(backoffDelay(1)).toBe(2000);
        expect(backoffDelay(3)).toBe(8000);
        expect(backoffDelay(99)).toBe(30000);
        expect(backoffDelay(-1)).toBe(1000);
    });
});

describe('freezesWhenHidden', () => {
    it('tells phones and tablets from desktops', () => {
        expect(freezesWhenHidden({ userAgent: 'Mozilla/5.0 (Linux; Android 14; Pixel 7) Mobile Safari/537.36' })).toBe(true);
        expect(freezesWhenHidden({ userAgent: 'Mozilla/5.0 (iPhone; CPU iPhone OS 18_0 like Mac OS X)' })).toBe(true);
        expect(freezesWhenHidden({ userAgent: 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7)', maxTouchPoints: 5 })).toBe(true);
        expect(freezesWhenHidden({ userAgent: 'x', userAgentData: { mobile: true } })).toBe(true);
        expect(freezesWhenHidden({ userAgent: 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7)', maxTouchPoints: 0 })).toBe(false);
        expect(freezesWhenHidden({ userAgent: 'Mozilla/5.0 (X11; Linux x86_64) Chrome/140' })).toBe(false);
        expect(freezesWhenHidden(null)).toBe(false);
    });
});

function fakeEnv() {
    const listeners = {};
    const target = {
        addEventListener: (n, f) => { listeners[n] = f; },
        removeEventListener: (n) => { delete listeners[n]; },
    };
    const documentObj = {
        visibilityState: 'visible',
        addEventListener: (n, f) => { listeners['doc:' + n] = f; },
        removeEventListener: (n) => { delete listeners['doc:' + n]; },
    };
    const navigatorObj = {
        connection: {
            addEventListener: (n, f) => { listeners['net:' + n] = f; },
            removeEventListener: (n) => { delete listeners['net:' + n]; },
        },
    };
    return { listeners, target, documentObj, navigatorObj };
}

describe('ConnectionRecovery', () => {
    it('calls onResume on online and on becoming visible, not while hidden', () => {
        const { listeners, target, documentObj } = fakeEnv();
        const onResume = vi.fn();
        const recovery = new ConnectionRecovery({ onResume, target, documentObj, navigatorObj: {}, wakeLock: false });
        recovery.start();
        listeners.online();
        expect(onResume).toHaveBeenCalledWith('online', { hiddenMs: 0, networkChanged: true });
        documentObj.visibilityState = 'hidden';
        listeners['doc:visibilitychange']();
        expect(onResume).toHaveBeenCalledTimes(1);
        documentObj.visibilityState = 'visible';
        listeners['doc:visibilitychange']();
        expect(onResume).toHaveBeenCalledTimes(2);
        recovery.stop();
        expect(listeners.online).toBeUndefined();
    });

    it('tells the app when the page goes to the background and how long it was away', () => {
        const { listeners, target, documentObj, navigatorObj } = fakeEnv();
        let now = 1000;
        const onResume = vi.fn();
        const onHide = vi.fn();
        const recovery = new ConnectionRecovery({ onResume, onHide, target, documentObj, navigatorObj, wakeLock: false, now: () => now });
        recovery.start();

        documentObj.visibilityState = 'hidden';
        listeners['doc:visibilitychange']();
        expect(onHide).toHaveBeenCalledTimes(1);

        now += 45000;
        documentObj.visibilityState = 'visible';
        listeners['doc:visibilitychange']();
        expect(onResume).toHaveBeenLastCalledWith('visible', { hiddenMs: 45000, networkChanged: false });

        // Shown again without having been hidden: nothing was missed.
        listeners['doc:visibilitychange']();
        expect(onResume).toHaveBeenLastCalledWith('visible', { hiddenMs: 0, networkChanged: false });
    });

    it('resumes after the back/forward cache, a lifecycle unfreeze and a network change', () => {
        const { listeners, target, documentObj, navigatorObj } = fakeEnv();
        const onResume = vi.fn();
        const recovery = new ConnectionRecovery({ onResume, target, documentObj, navigatorObj, wakeLock: false });
        recovery.start();

        listeners.pageshow({ persisted: false });
        expect(onResume).not.toHaveBeenCalled();
        listeners.pageshow({ persisted: true });
        expect(onResume).toHaveBeenLastCalledWith('pageshow', expect.any(Object));
        listeners['doc:resume']();
        expect(onResume).toHaveBeenLastCalledWith('resume', expect.any(Object));

        // A network change counts even in the background: Android keeps the
        // page running a while, and it may still have peers to serve.
        documentObj.visibilityState = 'hidden';
        listeners['net:change']();
        expect(onResume).toHaveBeenLastCalledWith('network', { hiddenMs: 0, networkChanged: true });

        recovery.stop();
        expect(listeners['net:change']).toBeUndefined();
        expect(listeners['doc:resume']).toBeUndefined();
    });

    it('acquires a screen wake lock and tolerates its absence', async () => {
        const { target, documentObj } = fakeEnv();
        const sentinel = { release: vi.fn() };
        const withLock = new ConnectionRecovery({
            onResume: vi.fn(), target, documentObj,
            navigatorObj: { wakeLock: { request: vi.fn().mockResolvedValue(sentinel) } }
        });
        await withLock.requestWakeLock();
        expect(withLock.wakeLockSentinel).toBe(sentinel);
        await withLock.releaseWakeLock();
        expect(sentinel.release).toHaveBeenCalled();

        const without = new ConnectionRecovery({ onResume: vi.fn(), target, documentObj, navigatorObj: {} });
        await expect(without.requestWakeLock()).resolves.toBeNull();
    });
});
