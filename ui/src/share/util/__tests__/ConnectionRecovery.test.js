import { describe, it, expect, vi } from 'vitest';
import ConnectionRecovery, { backoffDelay } from '../ConnectionRecovery';

describe('backoffDelay', () => {
    it('grows exponentially and caps', () => {
        expect(backoffDelay(0)).toBe(1000);
        expect(backoffDelay(1)).toBe(2000);
        expect(backoffDelay(3)).toBe(8000);
        expect(backoffDelay(99)).toBe(30000);
        expect(backoffDelay(-1)).toBe(1000);
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
    return { listeners, target, documentObj };
}

describe('ConnectionRecovery', () => {
    it('calls onResume on online and on becoming visible, not while hidden', () => {
        const { listeners, target, documentObj } = fakeEnv();
        const onResume = vi.fn();
        const recovery = new ConnectionRecovery({ onResume, target, documentObj, navigatorObj: {}, wakeLock: false });
        recovery.start();
        listeners.online();
        expect(onResume).toHaveBeenCalledWith('online');
        documentObj.visibilityState = 'hidden';
        listeners['doc:visibilitychange']();
        expect(onResume).toHaveBeenCalledTimes(1);
        documentObj.visibilityState = 'visible';
        listeners['doc:visibilitychange']();
        expect(onResume).toHaveBeenCalledTimes(2);
        recovery.stop();
        expect(listeners.online).toBeUndefined();
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
