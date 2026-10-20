// Receives photos shared into PhotoGroup from other apps, through the
// manifest's share_target, and keeps them for the page to pick up. That is
// all it does: it caches nothing and lets every other request through.

const DB = 'photogroup-share-target';
const STORE = 'shared-files';

self.addEventListener('install', () => self.skipWaiting());
self.addEventListener('activate', event => event.waitUntil(self.clients.claim()));

self.addEventListener('fetch', event => {
    const url = new URL(event.request.url);
    if (url.pathname !== '/share-target' || event.request.method !== 'POST') return;
    event.respondWith(receive(event.request));
});

async function receive(request) {
    try {
        const form = await request.formData();
        const files = form.getAll('media').filter(item => item instanceof File);
        await store(files);
        return Response.redirect('/?shared=1', 303);
    } catch (err) {
        console.error('Share target error', err);
        return Response.redirect('/?shared=error', 303);
    }
}

function openDb() {
    return new Promise((resolve, reject) => {
        const request = indexedDB.open(DB, 2);
        request.onupgradeneeded = () => {
            const db = request.result;
            if (!db.objectStoreNames.contains(STORE)) db.createObjectStore(STORE, { keyPath: 'id' });
        };
        request.onsuccess = () => resolve(request.result);
        request.onerror = () => reject(request.error);
    });
}

/** Replace what is waiting with these files, all in one transaction. Files are kept as blobs, not read into memory. */
async function store(files) {
    const db = await openDb();
    await new Promise((resolve, reject) => {
        const tx = db.transaction(STORE, 'readwrite');
        const shelf = tx.objectStore(STORE);
        shelf.clear();
        const at = Date.now();
        files.forEach((file, index) => shelf.add({
            id: `${at}-${index}`, file, name: file.name, type: file.type, lastModified: file.lastModified,
        }));
        tx.oncomplete = resolve;
        tx.onerror = () => reject(tx.error);
        tx.onabort = () => reject(tx.error);
    });
    db.close();
}
