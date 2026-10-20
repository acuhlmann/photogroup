import Logger from 'js-logger';

// The page's side of sharing into PhotoGroup from other apps. The service
// worker (public/share-target-sw.js) keeps the shared files and opens the
// app at "/?shared=1"; the app goes to the room used last and, once it's
// ready, takes the files and adds them like a pick from Share.

const DB = 'photogroup-share-target';
const STORE = 'shared-files';
const LAST_ROOM = 'photogroup.lastRoom';
const WORKER = '/share-target-sw.js';

/** Register the service worker that receives shares. It caches nothing. */
export function registerShareTarget(nav = navigator) {
    if (!nav || !nav.serviceWorker) return Promise.resolve(null);
    return nav.serviceWorker.register(WORKER, { scope: '/' }).catch(err => {
        Logger.warn('Sharing into PhotoGroup is unavailable: ' + (err && err.message ? err.message : err));
        return null;
    });
}

export function rememberRoom(id) {
    if (!id) return;
    try {
        localStorage.setItem(LAST_ROOM, id);
    } catch {
        // Shares then wait until a room is opened.
    }
}

export function lastRoom() {
    try {
        return localStorage.getItem(LAST_ROOM);
    } catch {
        return null;
    }
}

/**
 * Before the app starts: a share opens "/?shared=1" without a room, so add
 * the room used last, and the photos land there. Without one, they wait
 * until a room is opened. Returns the share's state, or null if this isn't one.
 */
export function prepareShareLaunch(win = window) {
    const params = new URLSearchParams(win.location.search);
    const shared = params.get('shared');
    if (!shared) return null;
    const room = !params.has('room') && lastRoom();
    if (room) {
        params.set('room', room);
        win.history.replaceState({}, '', `${win.location.pathname}?${params}`);
    }
    return shared;
}

/** Drop "shared" from the address, keeping the room. */
export function clearShareFlag(win = window) {
    const params = new URLSearchParams(win.location.search);
    if (!params.has('shared')) return;
    params.delete('shared');
    const query = params.toString();
    win.history.replaceState({}, '', win.location.pathname + (query ? `?${query}` : ''));
}

function openDb(idb) {
    return new Promise((resolve, reject) => {
        const request = idb.open(DB, 2);
        request.onupgradeneeded = () => {
            const db = request.result;
            if (!db.objectStoreNames.contains(STORE)) db.createObjectStore(STORE, { keyPath: 'id' });
        };
        request.onsuccess = () => resolve(request.result);
        request.onerror = () => reject(request.error);
    });
}

/** The files the service worker kept, removed from its store; empty when there are none. */
export async function takeSharedFiles(idb = typeof indexedDB !== 'undefined' ? indexedDB : null) {
    if (!idb) return [];
    const db = await openDb(idb);
    try {
        const records = await new Promise((resolve, reject) => {
            const tx = db.transaction(STORE, 'readwrite');
            const shelf = tx.objectStore(STORE);
            const all = shelf.getAll();
            all.onsuccess = () => shelf.clear();
            tx.oncomplete = () => resolve(all.result || []);
            tx.onerror = () => reject(tx.error);
            tx.onabort = () => reject(tx.error);
        });
        return records
            .sort((a, b) => String(a.id).localeCompare(String(b.id), undefined, { numeric: true }))
            .filter(record => record.file instanceof Blob)
            .map(record => (record.file instanceof File && record.file.name === record.name
                ? record.file
                : new File([record.file], record.name || 'shared', { type: record.type || record.file.type, lastModified: record.lastModified })));
    } finally {
        db.close();
    }
}

/** What went wrong with a share, by its "shared" value. */
export const SHARE_ERRORS = {
    missed: 'Those photos didn’t reach PhotoGroup. Now that it’s open, share them again.',
    error: 'Couldn’t receive the shared photos. Try sharing them again.',
};

export const SHARE_WAITING = 'Open or create a room, and the photos you shared will be added to it.';
