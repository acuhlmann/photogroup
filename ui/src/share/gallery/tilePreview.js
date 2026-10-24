/**
 * The small preview picture a tile carries: a photo's thumbnail, a song's
 * album art or a frame of a clip, sent as a "Thumbnail <name>" file in the
 * same torrent, ahead of the file itself (see torrent/ThumbnailExtractor).
 *
 * The URL is made once and kept on the tile as `previewUrl`: a fresh blob
 * URL on every render would reload the picture.
 */
import Logger from 'js-logger';

// infoHash -> the preview being fetched from the torrent, then its URL, so a
// copy of the tile (the gallery merges updates into new objects) finds it too.
const loading = new Map();
const fetched = new Map();

/** The preview this device already has: kept, or one of the thumbnails it shared. */
export function previewUrlOf(tile) {
    if (!tile) return null;
    if (tile.previewUrl) return tile.previewUrl;
    if (fetched.has(tile.infoHash)) {
        tile.previewUrl = fetched.get(tile.infoHash);
        return tile.previewUrl;
    }
    const thumb = (tile.thumbnailFiles || []).find(item => item?.name === 'Thumbnail ' + tile.fileName);
    if (thumb && typeof URL.createObjectURL === 'function') {
        tile.previewUrl = URL.createObjectURL(thumb);
    }
    return tile.previewUrl || null;
}

/** Bytes of a torrent file. WebTorrent 2+ has `blob()`; older versions `getBlobURL()`. */
async function torrentFileBlob(file) {
    if (typeof file.blob === 'function') return file.blob();
    if (typeof file.getBlobURL === 'function') {
        const url = await new Promise((resolve, reject) => file.getBlobURL((err, value) => err ? reject(err) : resolve(value)));
        try {
            return await (await fetch(url)).blob();
        } finally {
            URL.revokeObjectURL(url);
        }
    }
    return null;
}

/**
 * The tile's preview, fetching it from the torrent when it hasn't arrived
 * yet: the thumbnail is a few KB, so it lands long before the file. Resolves
 * to a URL, or null when there is none.
 */
export function loadPreviewUrl(tile) {
    const ready = previewUrlOf(tile);
    if (ready) return Promise.resolve(ready);
    const file = tile?.torrentFileThumb;
    if (!file || tile.secure) return Promise.resolve(null);
    const key = tile.infoHash || file;
    if (!loading.has(key)) {
        loading.set(key, torrentFileBlob(file)
            .then(blob => {
                if (!blob) return null;
                // Typed by its name ("Thumbnail clip.mp4"), so drop the type and
                // let the browser see it is a picture.
                tile.previewUrl = tile.previewUrl || URL.createObjectURL(new Blob([blob]));
                if (tile.infoHash) fetched.set(tile.infoHash, tile.previewUrl);
                return tile.previewUrl;
            })
            .catch(err => {
                Logger.warn('preview ' + (tile.fileName || '') + ': ' + (err?.message || err));
                return null;
            })
            .finally(() => loading.delete(key)));
    }
    return loading.get(key);
}

export default { previewUrlOf, loadPreviewUrl };
