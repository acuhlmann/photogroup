import { describe, it, expect, vi } from 'vitest';
import { forgetDevice } from './forgetDevice';

function fakeIdb(listed) {
    const deleted = [];
    return {
        deleted,
        databases: listed ? vi.fn().mockResolvedValue(listed.map(name => ({ name }))) : undefined,
        deleteDatabase(name) {
            deleted.push(name);
            const request = {};
            queueMicrotask(() => request.onsuccess());
            return request;
        },
    };
}

function fakeWindow() {
    return {
        localStorage: { clear: vi.fn() },
        sessionStorage: { clear: vi.fn() },
        location: { pathname: '/app/', replace: vi.fn() },
    };
}

describe('forgetDevice', () => {
    it('deletes the stored data and opens the front page', async () => {
        const win = fakeWindow();
        const idb = fakeIdb(['torrents', 'chunks-abc']);
        await forgetDevice({ win, idb });
        expect(win.localStorage.clear).toHaveBeenCalled();
        expect(win.sessionStorage.clear).toHaveBeenCalled();
        expect(idb.deleted.sort()).toEqual(['chunks-abc', 'image-blob-cache', 'torrents']);
        expect(win.location.replace).toHaveBeenCalledWith('/app/');
    });

    it('deletes the known databases when the browser cannot list them', async () => {
        const win = fakeWindow();
        const idb = fakeIdb(null);
        await forgetDevice({ win, idb });
        expect(idb.deleted.sort()).toEqual(['image-blob-cache', 'torrents']);
    });
});
