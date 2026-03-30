/**
 * ImageBlobCache - stores image blobs in IndexedDB so they survive page reloads
 * without requiring WebTorrent peer discovery.
 *
 * On first upload the original File is written here (keyed by photo infoHash).
 * On reload, Gallery checks this cache before falling through to the WebTorrent
 * piece-verification path that requires tracker/peer connectivity.
 */
import IdbKvStore from 'idb-kv-store';
import Logger from 'js-logger';

// Lazily initialised so that importing this module in test environments
// (jsdom/Node) that lack IndexedDB does not throw at module load time.
let _db = null;
function getDb() {
    if (_db) return _db;
    if (typeof indexedDB === 'undefined') return null;
    _db = new IdbKvStore('image-blob-cache');
    return _db;
}

/**
 * Store a blob (or File) for the given infoHash, overwriting any previous entry.
 * @param {string} infoHash
 * @param {Blob|File} blob
 * @returns {Promise<void>}
 */
export function cachePut(infoHash, blob) {
    const db = getDb();
    if (!db) return Promise.resolve();
    return new Promise((resolve, reject) => {
        db.set(infoHash, blob, (err) => {
            if (err) {
                Logger.warn('ImageBlobCache.put error for ' + infoHash + ': ' + err);
                reject(err);
            } else {
                Logger.debug('ImageBlobCache cached ' + infoHash);
                resolve();
            }
        });
    });
}

/**
 * Retrieve a cached blob for the given infoHash.
 * Resolves with null if not found.
 * @param {string} infoHash
 * @returns {Promise<Blob|File|null>}
 */
export function cacheGet(infoHash) {
    const db = getDb();
    if (!db) return Promise.resolve(null);
    return new Promise((resolve, reject) => {
        db.get(infoHash, (err, value) => {
            if (err) {
                Logger.warn('ImageBlobCache.get error for ' + infoHash + ': ' + err);
                reject(err);
            } else {
                resolve(value || null);
            }
        });
    });
}

/**
 * Remove the cached blob for the given infoHash (e.g. on torrent deletion).
 * Always resolves – errors are just logged.
 * @param {string} infoHash
 * @returns {Promise<void>}
 */
export function cacheDelete(infoHash) {
    const db = getDb();
    if (!db) return Promise.resolve();
    return new Promise((resolve) => {
        db.remove(infoHash, (err) => {
            if (err) Logger.warn('ImageBlobCache.delete error for ' + infoHash + ': ' + err);
            resolve();
        });
    });
}
