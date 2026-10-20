import download from 'downloadjs';
import Logger from 'js-logger';
import { embedDetails } from './metadata/embed/embedDetails';
import { rememberHave } from './alreadyHave';

function blobForSave(tile) {
    return new Promise((resolve, reject) => {
        if (tile.elem) {
            resolve(tile.elem);
            return;
        }

        if (tile.torrentFile && typeof tile.torrentFile.getBlob === 'function') {
            tile.torrentFile.getBlob((err, elem) => {
                if (err) {
                    Logger.error(err.message || String(err));
                    reject(err);
                    return;
                }
                resolve(elem);
            });
            return;
        }

        const error = new Error('This photo is not ready to save yet');
        Logger.error(error.message);
        reject(error);
    });
}

/**
 * The photo bytes to store on the device, with the room's shared details
 * written into the file when the format supports it.
 */
export function fileForSave(tile) {
    return blobForSave(tile).then(elem => embedDetails(elem, tile.details).catch(err => {
        Logger.warn('Saving without photo details: ' + (err.message || String(err)));
        return elem;
    }));
}

/**
 * Save a shared photo onto the local device using the existing download path,
 * with the room's shared details written into its metadata where possible.
 * Resolves once the browser has been handed the file.
 */
export function savePhoto(tile) {
    return fileForSave(tile).then(file => {
        try {
            download(file, tile.fileName);
        } catch (err) {
            Logger.error(err && err.message ? err.message : String(err));
            throw err;
        }
        rememberHave(tile.fingerprint, 'saved');
    });
}

export function saveLabel(fileSize, saving, saved) {
    if (saved) return 'Saved';
    if (saving) return 'Saving…';
    return fileSize ? `Save · ${fileSize}` : 'Save';
}
