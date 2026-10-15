import download from 'downloadjs';
import Logger from 'js-logger';

/**
 * Save a shared photo onto the local device using the existing download path.
 * Resolves once the browser has been handed the file.
 */
export function savePhoto(tile) {
    return new Promise((resolve, reject) => {
        const finish = (elem) => {
            download(elem, tile.fileName);
            resolve();
        };

        if (tile.elem) {
            finish(tile.elem);
            return;
        }

        if (tile.torrentFile && typeof tile.torrentFile.getBlob === 'function') {
            tile.torrentFile.getBlob((err, elem) => {
                if (err) {
                    Logger.error(err.message || String(err));
                    reject(err);
                    return;
                }
                finish(elem);
            });
            return;
        }

        const error = new Error('This photo is not ready to save yet');
        Logger.error(error.message);
        reject(error);
    });
}

export function saveLabel(fileSize, saving, saved) {
    if (saved) return 'Saved';
    if (saving) return 'Saving…';
    return fileSize ? `Save · ${fileSize}` : 'Save';
}
