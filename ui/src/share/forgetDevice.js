// "Forget this device": delete everything PhotoGroup keeps in this browser
// (rooms list with private room keys, name, saved photos, choices) and
// start again on the front page. Rooms and photos elsewhere stay.

const DATABASES = ['image-blob-cache', 'torrents'];

function deleteDatabase(idb, name) {
    return new Promise(resolve => {
        const request = idb.deleteDatabase(name);
        request.onsuccess = request.onerror = request.onblocked = () => resolve();
    });
}

/**
 * Take this browser off the push list before its session data goes, so a
 * forgotten device is not being told about rooms it no longer knows the way
 * into. The browser subscription itself is dropped, which stops every room at
 * once: the rooms left holding this endpoint on the server are cleaned up when
 * the push service answers a later attempt with a gone.
 */
async function forgetPush(win) {
    const worker = win?.navigator?.serviceWorker;
    if (!worker || !('PushManager' in win)) return;
    try {
        const registration = await worker.ready;
        const subscription = await registration.pushManager.getSubscription();
        if (subscription) await subscription.unsubscribe();
    } catch { /* a browser that will not hand one over is one that will not be told */ }
}

export async function forgetDevice({ win = window, idb = win.indexedDB } = {}) {
    await forgetPush(win);
    try { win.localStorage.clear(); } catch { /* storage blocked */ }
    try { win.sessionStorage.clear(); } catch { /* storage blocked */ }
    if (idb) {
        let names = DATABASES;
        try {
            const listed = await idb.databases?.();
            if (listed) names = [...new Set([...names, ...listed.map(db => db.name).filter(Boolean)])];
        } catch { /* not supported: delete the known ones */ }
        await Promise.all(names.map(name => deleteDatabase(idb, name)));
    }
    win.location.replace(win.location.pathname);
}
