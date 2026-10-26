/**
 * The small preview picture a tile carries: a photo's thumbnail, a song's
 * album art or a frame of a clip, sent as a "Thumbnail <name>" file in the
 * same torrent, ahead of the file itself (see torrent/ThumbnailExtractor).
 *
 * A clip whose sharer could not decode it (an iPhone's HEVC clip shared from
 * a Linux laptop) comes without one. The first device in the room that can
 * decode it grabs a frame and gives it to the room as the photo's `poster`,
 * so the sharer and others who can't play the clip still see what it is.
 *
 * The URL is made once and kept on the tile as `previewUrl`: a fresh blob
 * URL on every render would reload the picture.
 */
import Logger from 'js-logger';
import { posterFromFile } from '../util/videoFrame';

// infoHash -> the preview being fetched from the torrent, then its URL, so a
// copy of the tile (the gallery merges updates into new objects) finds it too.
const loading = new Map();
const fetched = new Map();
// Clips this device could not grab a frame of.
const undecodable = new Set();
// Where frames this device grabbed go: set by the gallery to the room's service.
let posterSink = null;

/** Hand frames this device grabs of poster-less clips to `sink(tile, dataUrl)`; null stops it. */
export function setPosterSink(sink) {
    posterSink = sink;
}

/** The preview this device already has: kept, the room's poster, or one of the thumbnails it shared. */
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
    return tile.previewUrl || tile.poster || null;
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

/** The whole clip on this device, or null while it is still arriving. */
async function localClip(tile) {
    const file = tile.elem || tile.file;
    if (file instanceof Blob) return file;
    if (tile.torrentFile && tile.torrentFile.done) return torrentFileBlob(tile.torrentFile);
    return null;
}

const dataUrlOf = blob => new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(reader.result);
    reader.onerror = () => reject(reader.error);
    reader.readAsDataURL(blob);
});

/**
 * A frame of a clip that came without a preview, grabbed from the whole
 * clip once it is here, and given to the room. Resolves to a URL, or null.
 */
async function frameOfClip(tile) {
    const clip = await localClip(tile);
    if (!clip) return null;
    const poster = await posterFromFile(clip, { maxSide: 320, quality: 0.7 });
    if (!poster) {
        undecodable.add(tile.infoHash);
        return null;
    }
    const url = URL.createObjectURL(poster);
    if (posterSink && !tile.poster) {
        dataUrlOf(poster)
            .then(dataUrl => posterSink(tile, dataUrl))
            .catch(err => Logger.warn('poster ' + (tile.fileName || '') + ': ' + (err?.message || err)));
    }
    return url;
}

/**
 * The tile's preview, fetching it from the torrent when it hasn't arrived
 * yet: the thumbnail is a few KB, so it lands long before the file. A clip
 * without one gets a frame of its own once it is here. Resolves to a URL,
 * or null when there is none.
 */
export function loadPreviewUrl(tile) {
    const ready = previewUrlOf(tile);
    if (ready) return Promise.resolve(ready);
    if (!tile || tile.secure) return Promise.resolve(null);
    const file = tile.torrentFileThumb;
    const clipFrame = !file && tile.isVideo && !undecodable.has(tile.infoHash);
    if (!file && !clipFrame) return Promise.resolve(null);
    const key = tile.infoHash || file;
    if (!loading.has(key)) {
        const made = file
            // Typed by its name ("Thumbnail clip.mp4"), so drop the type and
            // let the browser see it is a picture.
            ? torrentFileBlob(file).then(blob => blob && URL.createObjectURL(new Blob([blob])))
            : frameOfClip(tile);
        loading.set(key, made
            .then(url => {
                if (!url) return null;
                tile.previewUrl = tile.previewUrl || url;
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

export default { previewUrlOf, loadPreviewUrl, setPosterSink };
