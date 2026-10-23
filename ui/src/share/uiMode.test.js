import { describe, it, expect, vi, beforeEach } from 'vitest';
import { readMode, saveMode } from './uiMode';

/** A working localStorage; the shared test setup stubs one that stores nothing. */
function memoryStorage(initial = {}) {
    const items = new Map(Object.entries(initial));
    return {
        getItem: key => (items.has(key) ? items.get(key) : null),
        setItem: (key, value) => items.set(key, String(value)),
        removeItem: key => items.delete(key),
    };
}

describe('uiMode', () => {
    beforeEach(() => vi.stubGlobal('localStorage', memoryStorage()));

    it('starts someone new in simple mode', () => {
        expect(readMode()).toBe('simple');
    });

    it('keeps people who were here before modes in the view they know', () => {
        vi.stubGlobal('localStorage', memoryStorage({ clientId: 'abc' }));
        expect(readMode()).toBe('default');
    });

    it('comes back in the mode picked last', () => {
        saveMode('geek');
        expect(readMode()).toBe('geek');
        saveMode('simple');
        localStorage.setItem('clientId', 'abc');
        expect(readMode()).toBe('simple');
    });

    it('ignores modes it does not know', () => {
        saveMode('fancy');
        expect(readMode()).toBe('simple');
        localStorage.setItem('photogroup.uiMode', 'fancy');
        expect(readMode()).toBe('simple');
    });

    it('still works when storage is blocked', () => {
        vi.stubGlobal('localStorage', {
            getItem: () => { throw new Error('blocked'); },
            setItem: () => { throw new Error('blocked'); },
        });
        expect(readMode()).toBe('simple');
        expect(() => saveMode('geek')).not.toThrow();
    });
});
