// Receives photos shared into PhotoGroup from other apps, through the
// manifest's share_target, and keeps them for the page to pick up. It also
// shows the push messages that tell a closed browser about new photos.
// That is all it does: it caches nothing and lets every other request through.

const DB = 'photogroup-share-target';
const STORE = 'shared-files';

self.addEventListener('install', () => self.skipWaiting());
self.addEventListener('activate', event => event.waitUntil(self.clients.claim()));

/**
 * A push message: the server's `{title, body, roomId, tag}`, encrypted to this
 * browser's own subscription key and decoded here. The tag is the room's, so a
 * second batch of photos replaces the first message instead of stacking, and a
 * notice the page already showed for the same room is the same notice.
 *
 * A rotated subscription cannot be re-registered from here: the server wants
 * proof of being in the room, and only the page has that. Every room open
 * re-subscribes, and an endpoint the browser threw away is answered with a
 * gone and dropped by the server, so a change like that costs at most one
 * message.
 */
self.addEventListener('push', event => {
    let message = {};
    try {
        message = event.data ? event.data.json() : {};
    } catch { /* a body that is not ours: fall back to the plain news */ }
    const options = {
        body: message.body || 'New photos in PhotoGroup',
        tag: message.tag || 'photogroup-new-photos',
        icon: '/icons-192.png',
        badge: '/icons-192.png',
        data: { roomId: message.roomId },
    };
    event.waitUntil(self.registration.showNotification(message.title || 'PhotoGroup', options));
});

/** Tapping it opens the room the news was about, in a page that is already there if there is one. */
self.addEventListener('notificationclick', event => {
    event.notification.close();
    const roomId = event.notification.data?.roomId;
    // A private room's key is not in here: the page reads it from where this
    // browser keeps its rooms, the same way the link does.
    const href = roomId ? '/?room=' + encodeURIComponent(roomId) : '/';
    event.waitUntil((async () => {
        if (roomId) {
            const marker = 'room=' + encodeURIComponent(roomId);
            const windows = await self.clients.matchAll({ type: 'window', includeUncontrolled: true });
            const already = windows.find(item => item.url.includes(marker));
            // Focus only: a WindowClient has no navigate, so bringing the page
            // forward is all a tap can do to one that is already open.
            if (already) return already.focus();
        }
        return self.clients.openWindow(href);
    })());
});

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
