import download from 'downloadjs';
import Logger from 'js-logger';
import { downloadZip } from 'client-zip';
import { fileForSave } from './savePhoto';
import { rememberHave } from './alreadyHave';

/** Whether a tile's whole file is on this device, so it can be saved. */
export function isReadyToSave(tile) {
    if (tile.elem) return true;
    return !!(tile.torrentFile && tile.torrentFile.done && canReadTorrentFile(tile.torrentFile));
}

/** Whether a torrent file can hand over its bytes: `blob()` in WebTorrent 2+, `getBlob()` before. */
export function canReadTorrentFile(file) {
    return !!file && (typeof file.blob === 'function' || typeof file.getBlob === 'function');
}

/**
 * A file name in the zip for each tile, made unique ("beach.jpg",
 * "beach (2).jpg") without regard to case, so every photo survives unzipping.
 */
export function zipEntryNames(tiles) {
    const taken = new Set();
    return tiles.map(tile => {
        const name = String(tile.fileName || 'photo').replace(/[/\\]/g, '_').trim() || 'photo';
        const dot = name.lastIndexOf('.');
        const [stem, extension] = dot > 0 ? [name.slice(0, dot), name.slice(dot)] : [name, ''];
        let candidate = name;
        for (let copy = 2; taken.has(candidate.toLowerCase()); copy++) candidate = `${stem} (${copy})${extension}`;
        taken.add(candidate.toLowerCase());
        return candidate;
    });
}

/** "photogroup-<room>.zip", or "photogroup-room.zip" without a room id. */
export function zipName(roomId) {
    const id = String(roomId || '').replace(/[^\w-]/g, '');
    return `photogroup-${id || 'room'}.zip`;
}

function takenDate(tile) {
    const date = tile.picDateTakenDate;
    return date instanceof Date && Number.isFinite(date.getTime()) ? date : undefined;
}

/**
 * Save every photo in the room that is here in full as one zip, each with
 * the room's shared details written into its file the way a single save
 * does. Photos still arriving, or that can't be read, are left out.
 * `onProgress(done, total)` follows the photos as they go in.
 * Resolves to how many photos were saved and left out.
 */
export async function saveRoom(tiles, { roomId, onProgress = () => {}, save = download } = {}) {
    const ready = tiles.filter(isReadyToSave);
    if (!ready.length) throw new Error('No photos are ready to save yet');
    const names = zipEntryNames(ready);
    let saved = 0;
    let failed = 0;
    const fingerprints = [];

    // One photo at a time, so a big room doesn't hold every file in memory twice.
    async function* entries() {
        for (let index = 0; index < ready.length; index++) {
            const tile = ready[index];
            try {
                const input = await fileForSave(tile);
                saved += 1;
                fingerprints.push(tile.fingerprint);
                yield { name: names[index], input, lastModified: takenDate(tile) };
            } catch (err) {
                failed += 1;
                Logger.warn('Left ' + tile.fileName + ' out of the zip: ' + (err && err.message ? err.message : String(err)));
            }
            onProgress(index + 1, ready.length);
        }
    }

    const zip = await downloadZip(entries()).blob();
    if (!saved) throw new Error('None of the photos could be read');
    // Awaited, so a save that can fail or be cancelled (the browser's save
    // dialog) is finished before these photos count as had.
    await save(zip, zipName(roomId), 'application/zip');
    rememberHave(fingerprints, 'saved');
    return { saved, skipped: tiles.length - ready.length + failed };
}
