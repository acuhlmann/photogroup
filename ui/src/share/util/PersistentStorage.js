import Logger from 'js-logger';

/**
 * Ask the browser not to throw away what this room saved on the device.
 *
 * Shared photos are kept in IndexedDB: images in the blob cache, every photo's
 * pieces in the torrent's chunk store. That storage is *best effort* by
 * default, and a browser under pressure frees it — mobile browsers first, and
 * video before images, because video is the biggest thing in the room. With
 * permission the origin is durable instead, and a clip a person shared stays
 * there for them to restore after a refresh, which is the difference between
 * the room remembering their upload and losing it.
 *
 * Granting is the browser's call, not the user's: it weighs how often the page
 * is visited. So this reports the outcome and stays quiet when refused.
 */
export async function requestPersistentStorage(storage = navigator.storage) {
    if (!storage || typeof storage.persist !== 'function') {
        Logger.info('Storage: this browser cannot keep files durably');
        return false;
    }
    try {
        if (typeof storage.persisted === 'function' && await storage.persisted()) return true;
        const granted = await storage.persist();
        if (granted) Logger.info('Storage: the browser will keep this room\'s photos');
        else Logger.info('Storage: the browser may free this room\'s photos when space is short');
        return !!granted;
    } catch (err) {
        Logger.warn('Storage: could not ask to keep photos: ' + (err?.message || err));
        return false;
    }
}

/** Whether the browser has granted it, for the panel that reports the device. */
export async function persistentStorageGranted(storage = navigator.storage) {
    if (!storage || typeof storage.persisted !== 'function') return false;
    try {
        return await storage.persisted();
    } catch {
        return false;
    }
}
