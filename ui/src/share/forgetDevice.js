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

export async function forgetDevice({ win = window, idb = win.indexedDB } = {}) {
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
