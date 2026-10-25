import { describe, it, expect, vi, beforeEach } from 'vitest';
import { clearShareFlag, lastRoom, prepareShareLaunch, registerShareTarget, rememberRoom, takeSharedFiles } from './shareTarget';

/** A working localStorage; the shared test setup stubs one that stores nothing. */
function memoryStorage() {
    const items = new Map();
    return {
        getItem: key => (items.has(key) ? items.get(key) : null),
        setItem: (key, value) => items.set(key, String(value)),
        removeItem: key => items.delete(key),
    };
}

/** Just enough of window for the address helpers. */
function fakeWindow(search, hash = '') {
    const win = {
        location: { pathname: '/', search, hash },
        history: {
            replaceState: vi.fn((state, title, url) => {
                win.location.search = url.includes('?') ? url.slice(url.indexOf('?')) : '';
            }),
        },
    };
    return win;
}

describe('shareTarget', () => {
    beforeEach(() => vi.stubGlobal('localStorage', memoryStorage()));

    it('remembers the room used last', () => {
        expect(lastRoom()).toBeNull();
        rememberRoom('abc');
        rememberRoom(undefined);
        expect(lastRoom()).toBe('abc');
    });

    it('sends a share to the room used last', () => {
        rememberRoom('trip');
        const win = fakeWindow('?shared=1');
        expect(prepareShareLaunch(win)).toBe('1');
        expect(win.history.replaceState).toHaveBeenCalledWith({}, '', '/?shared=1&room=trip');
    });

    it('keeps a room already in the address, and leaves other launches alone', () => {
        rememberRoom('trip');
        const inRoom = fakeWindow('?room=other&shared=1');
        expect(prepareShareLaunch(inRoom)).toBe('1');
        expect(inRoom.history.replaceState).not.toHaveBeenCalled();

        const plain = fakeWindow('?room=other');
        expect(prepareShareLaunch(plain)).toBeNull();
        expect(plain.history.replaceState).not.toHaveBeenCalled();
    });

    it('lets a share wait when no room was used yet', () => {
        const win = fakeWindow('?shared=1');
        expect(prepareShareLaunch(win)).toBe('1');
        expect(win.history.replaceState).not.toHaveBeenCalled();
    });

    it('drops the share flag from the address, keeping the room', () => {
        const win = fakeWindow('?shared=1&room=trip');
        clearShareFlag(win);
        expect(win.history.replaceState).toHaveBeenCalledWith({}, '', '/?room=trip');
        const bare = fakeWindow('?shared=missed');
        clearShareFlag(bare);
        expect(bare.history.replaceState).toHaveBeenCalledWith({}, '', '/');
        // A private room's key stays.
        const keyed = fakeWindow('?shared=1&room=trip', '#k=abc');
        clearShareFlag(keyed);
        expect(keyed.history.replaceState).toHaveBeenCalledWith({}, '', '/?room=trip#k=abc');
    });

    it('registers the share worker for the whole site, and copes without one', async () => {
        const register = vi.fn().mockResolvedValue('registration');
        expect(await registerShareTarget({ serviceWorker: { register } })).toBe('registration');
        expect(register).toHaveBeenCalledWith('/share-target-sw.js', { scope: '/' });
        expect(await registerShareTarget({ serviceWorker: { register: vi.fn().mockRejectedValue(new Error('insecure')) } })).toBeNull();
        expect(await registerShareTarget({})).toBeNull();
    });

    it('has nothing to take where there is no IndexedDB', async () => {
        expect(await takeSharedFiles(null)).toEqual([]);
    });
});
