import { describe, it, expect, vi, beforeEach } from 'vitest';
import { alreadyHave, clearHave, onHaveChange, rememberHave } from './alreadyHave';

const fp = n => `${n}:${String(n).padStart(64, '0')}`;

/** A working localStorage; the shared test setup stubs one that stores nothing. */
function memoryStorage() {
    const items = new Map();
    return {
        getItem: key => (items.has(key) ? items.get(key) : null),
        setItem: (key, value) => items.set(key, String(value)),
        removeItem: key => items.delete(key),
    };
}

describe('alreadyHave', () => {
    beforeEach(() => {
        vi.stubGlobal('localStorage', memoryStorage());
        clearHave();
    });

    it('knows photos shared, saved or found here, by fingerprint', () => {
        rememberHave([fp(1), fp(2)], 'saved');
        rememberHave(fp(3), 'device');
        expect(alreadyHave({ fingerprint: fp(1) })).toBe('saved');
        expect(alreadyHave({ fingerprint: fp(3) })).toBe('device');
        expect(alreadyHave({ fingerprint: fp(4) })).toBeNull();
        expect(alreadyHave({})).toBeNull();
        expect(alreadyHave(null)).toBeNull();
    });

    it("counts this browser's own uploads, fingerprint or not", () => {
        expect(alreadyHave({ seed: true })).toBe('shared');
    });

    it('keeps the latest reason', () => {
        rememberHave(fp(1), 'saved');
        rememberHave(fp(1), 'device');
        expect(alreadyHave({ fingerprint: fp(1) })).toBe('device');
    });

    it('ignores missing fingerprints', () => {
        const listener = vi.fn();
        const stop = onHaveChange(listener);
        rememberHave([null, undefined], 'saved');
        expect(listener).not.toHaveBeenCalled();
        stop();
    });

    it('tells listeners about changes until they unsubscribe', () => {
        const listener = vi.fn();
        const stop = onHaveChange(listener);
        rememberHave(fp(1), 'saved');
        expect(listener).toHaveBeenCalledTimes(1);
        stop();
        rememberHave(fp(2), 'saved');
        expect(listener).toHaveBeenCalledTimes(1);
    });

    it('survives a reload', async () => {
        rememberHave(fp(7), 'shared');
        vi.resetModules();
        const reloaded = await import('./alreadyHave');
        expect(reloaded.alreadyHave({ fingerprint: fp(7) })).toBe('shared');
    });

    it('still works when storage is blocked', async () => {
        const blocked = () => { throw new Error('blocked'); };
        vi.stubGlobal('localStorage', { getItem: blocked, setItem: blocked, removeItem: blocked });
        vi.resetModules();
        const fresh = await import('./alreadyHave');
        fresh.rememberHave(fp(9), 'saved');
        expect(fresh.alreadyHave({ fingerprint: fp(9) })).toBe('saved');
    });
});
