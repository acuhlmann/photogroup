import Logger from 'js-logger';
import { fileForSave, savePhoto } from '../gallery/savePhoto';
import { isReadyToSave, saveRoom, zipEntryNames } from '../gallery/saveRoom';
import { rememberHave } from '../gallery/alreadyHave';

/**
 * Whether this is a phone or tablet whose share sheet takes files. There,
 * "Save Image" puts photos in the camera roll, where a download only reaches Files.
 */
export function canShareFiles() {
    if (typeof navigator === 'undefined' || typeof navigator.share !== 'function' || typeof navigator.canShare !== 'function') {
        return false;
    }
    const touch = typeof window !== 'undefined' && window.matchMedia && window.matchMedia('(pointer: coarse)').matches;
    if (!touch) return false;
    try {
        return navigator.canShare({ files: [new File(['x'], 'photo.jpg', { type: 'image/jpeg' })] });
    } catch {
        return false;
    }
}

/**
 * Put photos on this device the simplest way it has: the share sheet on a
 * phone, otherwise a download (one file, or one zip for several).
 * Photos still arriving are left out. Resolves to 'shared', 'saved' or 'cancelled'.
 */
export async function saveToDevice(tiles, { roomId } = {}) {
    const ready = tiles.filter(isReadyToSave);
    if (!ready.length) throw new Error('Not here yet');

    if (canShareFiles()) {
        const names = zipEntryNames(ready);
        const files = await Promise.all(ready.map(async (tile, index) =>
            new File([await fileForSave(tile)], names[index], { type: tile.fileType || '' })));
        if (navigator.canShare({ files })) {
            try {
                await navigator.share({ files });
                rememberHave(ready.map(tile => tile.fingerprint), 'saved');
                return 'shared';
            } catch (err) {
                if (err && err.name === 'AbortError') return 'cancelled';
                // Too long after the tap, or not allowed: download instead.
                Logger.warn('Share sheet failed, downloading instead: ' + (err && err.message ? err.message : err));
            }
        }
    }

    if (ready.length === 1) {
        await savePhoto(ready[0]);
    } else {
        await saveRoom(ready, { roomId });
    }
    return 'saved';
}
