import download from 'downloadjs';
import Logger from 'js-logger';
import { fileForSave, savePhoto } from './savePhoto';
import { isReadyToSave, saveRoom, zipEntryNames } from './saveRoom';
import { rememberHave } from './alreadyHave';

// A web page can't write into a phone's photo library itself. What it can do:
// - iPhone and iPad: hand the files to the share sheet, whose "Save Image" or
//   "Save Video" puts them in Photos. A download only reaches the Files app.
// - Android: download them. Downloads land in the shared Download folder,
//   which gallery apps show as a "Download" album. The share sheet there has
//   no "save to gallery" choice, only other apps. Chrome's save dialog does
//   let the folder be named (DCIM/Camera), which is what
//   saveToChosenFolder.js offers alongside this.
// - Computers: download, one file, or one zip for several.

const userAgent = () => (typeof navigator === 'undefined' ? '' : navigator.userAgent || '');

/** 'ios' on an iPhone or iPad, 'android' on Android, otherwise null. */
export function phoneKind() {
    const agent = userAgent();
    if (/Android/i.test(agent)) return 'android';
    if (/iPhone|iPad|iPod/i.test(agent)) return 'ios';
    // iPadOS asks for desktop sites and says it is a Mac, but a Mac has no touch screen.
    if (/Macintosh/i.test(agent) && typeof navigator !== 'undefined' && navigator.maxTouchPoints > 1) return 'ios';
    return null;
}

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
 * How this device saves photos: 'share' (the share sheet), 'each' (one
 * download per file, so a gallery app sees each one) or 'download' (one
 * file, or one zip for several).
 */
export function saveWay() {
    const phone = phoneKind();
    if (phone === 'android') return 'each';
    if (canShareFiles()) return 'share';
    return 'download';
}

/**
 * Where saved photos go on this device, in one or two short sentences.
 * `done` says it after the save, without the step to take.
 * `chosen` is the save dialog the person steered themselves, so the answer
 * is only "where you said" and never mentions a folder this app picked.
 */
export function savedWhereText(count = 1, { way = saveWay(), done = false } = {}) {
    const them = count === 1 ? 'It goes' : 'They go';
    if (way === 'chosen') {
        return count === 1 ? 'It is in the folder you chose.' : 'They are in the folders you chose.';
    }
    if (way === 'share') {
        if (done) return `${count === 1 ? 'It is' : 'They are'} in your Photos app.`;
        return `Tap "Save" in the list that opens. ${them} to your Photos app.`;
    }
    if (way === 'each') return `${them} to your gallery app, in the Download album.`;
    if (count > 1) return 'One zip file goes to the Downloads folder of this computer.';
    return `${them} to the Downloads folder of this computer.`;
}

const pause = ms => new Promise(resolve => setTimeout(resolve, ms));

/**
 * Put photos on this device the best way it has (see `saveWay`). Photos still
 * arriving are left out. `files` can hold a ready File per tile key, made
 * before the tap, so the share sheet opens at once. Resolves to 'shared',
 * 'saved' or 'cancelled'.
 */
export async function saveToDevice(tiles, { roomId, files: made } = {}) {
    const ready = tiles.filter(isReadyToSave);
    if (!ready.length) throw new Error('Not here yet');
    const way = saveWay();
    const names = zipEntryNames(ready);
    const fileOf = async (tile, index) => {
        const key = tile.tileKey || tile.infoHash;
        const prepared = made && key && made.get(key);
        return prepared || new File([await fileForSave(tile)], names[index], { type: tile.fileType || '' });
    };

    if (way === 'share') {
        const files = await Promise.all(ready.map(fileOf));
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

    if (way === 'each') {
        // A zip would hide the photos from the gallery app, so one download each.
        for (let index = 0; index < ready.length; index++) {
            if (index) await pause(400);
            const file = await fileOf(ready[index], index);
            download(file, names[index], ready[index].fileType || file.type || undefined);
            rememberHave(ready[index].fingerprint, 'saved');
        }
        return 'saved';
    }

    if (ready.length === 1) {
        await savePhoto(ready[0]);
    } else {
        await saveRoom(ready, { roomId });
    }
    return 'saved';
}
