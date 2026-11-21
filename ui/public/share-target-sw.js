// Receives photos shared into PhotoGroup from other apps, through the
// manifest's share_target, and keeps them for the page to pick up. It also
// shows the push messages that tell a closed browser about new photos.
//
// It also keeps the app itself (the page and its code, never a photo and
// never an answer of the server), so PhotoGroup opens with no network. The
// page asks for that with a "keep-app" message after a production build
// loaded; until then nothing is kept and every request goes through.

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

const APP_CACHE = 'photogroup-app-v1';
// How long a page load waits for the network before the kept page is used.
// Short: a server that starts (or a slow network) must not hold up a page
// this phone already has. The fresh page is still kept for the next visit.
const PAGE_WAIT_MS = 1000;

/** Whether the app is kept: the page asked for it at least once. */
function keepsApp() {
    return caches.has(APP_CACHE);
}

/**
 * Keep the files of this build, and drop the code of older builds. The old
 * code goes only when all of the new code is here: with a part of the new
 * code and none of the old, the app would not open with no network.
 */
async function keepApp(files) {
    const cache = await caches.open(APP_CACHE);
    const wanted = new Set(files.map(file => new URL(file, self.location.origin).href));
    const kept = new Set((await cache.keys()).map(request => request.url));
    const built = url => new URL(url).pathname.startsWith('/assets/');
    let failed = 0;
    // One by one: a file that fails must not stop the others.
    for (const url of wanted) {
        // Built code has its content in its name: the kept one is the same.
        // A file with a fixed name (the page, the icons) can be newer now.
        if (kept.has(url) && built(url)) continue;
        try {
            const response = await fetch(url, { cache: 'no-cache' });
            if (response.ok) await cache.put(url, response);
            else failed++;
        } catch {
            failed++;
        }
    }
    if (!failed) {
        await Promise.all([...kept].filter(url => !wanted.has(url) && built(url)).map(url => cache.delete(url)));
    }
    return { files: wanted.size, failed };
}

self.addEventListener('message', event => {
    if (event.data?.type !== 'keep-app' || !Array.isArray(event.data.files)) return;
    event.waitUntil(keepApp(event.data.files.filter(file => typeof file === 'string').slice(0, 2000))
        .then(result => event.source?.postMessage({ type: 'app-kept', ...result }))
        .catch(() => {}));
});

/** Whether an answer to a page load is the app's page. */
function isAppPage(request, response) {
    const path = new URL(request.url).pathname;
    return (path === '/' || path === '/index.html') && !response.redirected
        && (response.headers.get('content-type') || '').includes('text/html');
}

/** The page: from the network when it answers soon, else the kept one. */
async function page(request) {
    const cache = await caches.open(APP_CACHE);
    const fresh = fetch(request).then((response) => {
        // Only the app's own page: another address of this site (a file that
        // opens in the tab, a page of the server) must not take its place.
        if (response.ok && isAppPage(request, response)) cache.put('/index.html', response.clone());
        return response;
    });
    const kept = await cache.match('/index.html', { ignoreVary: true });
    if (!kept) return fresh;
    let timer;
    const late = new Promise(resolve => { timer = setTimeout(() => resolve(null), PAGE_WAIT_MS); });
    try {
        const response = await Promise.race([fresh, late]);
        if (response && (response.ok || response.status < 500)) return response;
    } catch { /* no network */ } finally {
        clearTimeout(timer);
    }
    fresh.catch(() => {});
    return kept;
}

/** A file of the app: the kept one for built code (its name changes with its content), else the network first. */
async function appFile(request, url) {
    const cache = await caches.open(APP_CACHE);
    if (url.pathname.startsWith('/assets/')) {
        const kept = await cache.match(request, { ignoreVary: true });
        if (kept) return kept;
    }
    try {
        const response = await fetch(request);
        if (response.ok && response.type === 'basic') cache.put(request, response.clone());
        return response;
    } catch (err) {
        const kept = await cache.match(request, { ignoreVary: true });
        if (kept) return kept;
        throw err;
    }
}

self.addEventListener('fetch', event => {
    const url = new URL(event.request.url);
    if (url.pathname === '/share-target' && event.request.method === 'POST') {
        event.respondWith(receive(event.request));
        return;
    }
    // Only the app's own files. The server's answers and the tracker go through.
    if (event.request.method !== 'GET' || url.origin !== self.location.origin
        || url.pathname.startsWith('/api/') || url.pathname.startsWith('/ws') || event.request.headers.has('range')) return;
    event.respondWith((async () => {
        if (!(await keepsApp())) return fetch(event.request);
        return event.request.mode === 'navigate' ? page(event.request) : appFile(event.request, url);
    })());
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
