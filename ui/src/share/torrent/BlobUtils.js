/**
 * BlobUtils - Utilities for extracting blob data from WebTorrent files
 * 
 * Provides a simplified, Promise-based API for getting blobs from torrent files.
 */
import Logger from 'js-logger';

/**
 * Get a blob from a WebTorrent file using the most appropriate method.
 * 
 * Priority order:
 * 1. file.getBlob() - Standard WebTorrent API
 * 2. file.getBlobURL() + fetch - Fallback if getBlob unavailable
 * 
 * Note: createReadStream() is intentionally not included as a fallback because
 * it's meant for streaming scenarios, not for getting complete blobs.
 * 
 * @param {Object} torrentFile - WebTorrent file object
 * @returns {Promise<Blob>} The file as a Blob
 */
export function getBlobFromTorrentFile(torrentFile) {
    return new Promise((resolve, reject) => {
        if (!torrentFile) {
            reject(new Error('No torrent file provided'));
            return;
        }

        // Primary method: getBlob()
        if (typeof torrentFile.getBlob === 'function') {
            torrentFile.getBlob((err, blob) => {
                if (err) {
                    Logger.warn('getBlob failed, trying fallback: ' + err.message);
                    // Try fallback
                    getBlobViaURL(torrentFile).then(resolve).catch(reject);
                } else {
                    resolve(blob);
                }
            });
            return;
        }

        // Fallback: getBlobURL() + fetch
        if (typeof torrentFile.getBlobURL === 'function') {
            getBlobViaURL(torrentFile).then(resolve).catch(reject);
            return;
        }

        // No method available
        reject(new Error('No blob retrieval method available on torrent file'));
    });
}

/**
 * Get a blob by first getting a blob URL and then fetching it.
 * 
 * @param {Object} torrentFile - WebTorrent file object
 * @returns {Promise<Blob>} The file as a Blob
 */
function getBlobViaURL(torrentFile) {
    return new Promise((resolve, reject) => {
        if (typeof torrentFile.getBlobURL !== 'function') {
            reject(new Error('getBlobURL not available'));
            return;
        }

        torrentFile.getBlobURL((err, url) => {
            if (err) {
                reject(err);
                return;
            }

            fetch(url)
                .then(response => response.blob())
                .then(blob => {
                    // Optionally revoke the URL to free memory
                    URL.revokeObjectURL(url);
                    resolve(blob);
                })
                .catch(fetchErr => {
                    URL.revokeObjectURL(url);
                    reject(fetchErr);
                });
        });
    });
}

/**
 * Get blob from a photo object, handling various sources.
 * 
 * @param {Object} photo - Photo object with file or torrentFile
 * @returns {Promise<{photo: Object, blob: Blob|null}>} Photo with blob attached
 */
export async function getBlobFromPhoto(photo) {
    // If photo already has a file blob, use it directly
    if (photo.file && photo.file instanceof Blob) {
        photo.elem = photo.file;
        return { photo, blob: photo.file };
    }

    // Try to get blob from torrent file
    if (photo.torrentFile) {
        try {
            const blob = await getBlobFromTorrentFile(photo.torrentFile);
            photo.elem = blob;
            return { photo, blob };
        } catch (err) {
            Logger.error('Failed to get blob for ' + (photo.fileName || 'unknown') + ': ' + err.message);
            return { photo, blob: null };
        }
    }

    Logger.warn('No blob source available for ' + (photo.fileName || 'unknown'));
    return { photo, blob: null };
}

/**
 * Emit blobDone event for a photo.
 * 
 * @param {Object} emitter - Event emitter
 * @param {Object} photo - Photo object
 */
export function emitBlobDone(emitter, photo) {
    Logger.info('blobDone dispatch ' + (photo.fileName || photo.infoHash));
    emitter.emit('blobDone-' + photo.infoHash, photo);
}

/**
 * Get blob from photo and emit completion event.
 * This combines blob retrieval and event emission in one call.
 * 
 * @param {Object} photo - Photo object
 * @param {Object} emitter - Event emitter
 * @returns {Promise<{photo: Object, blob: Blob|null}>}
 */
export async function getBlobAndEmit(photo, emitter) {
    const result = await getBlobFromPhoto(photo);
    emitBlobDone(emitter, result.photo);
    return result;
}

export default {
    getBlobFromTorrentFile,
    getBlobFromPhoto,
    emitBlobDone,
    getBlobAndEmit
};

