import { roomCryptoKey } from '../privateRoom';
import { openFile } from '../security/roomKey';

export const SEALED_NO_KEY = 'This photo is encrypted. Open the room with its full link or code to see it.';
export const SEALED_WRONG_KEY = 'This photo could not be opened with the key in this link.';

/**
 * A private room's photo arrives sealed. Open it with the room's key and
 * give the photo its real name, type and file.
 */
export async function openSealedPhoto(photo, sealed) {
    const key = await roomCryptoKey();
    if (!key) throw new Error(SEALED_NO_KEY);
    let file;
    try {
        file = await openFile(key, sealed);
    } catch {
        throw new Error(SEALED_WRONG_KEY);
    }
    photo.fileName = file.name;
    photo.fileType = file.type || photo.fileType;
    photo.file = file;
    photo.isDecrypted = true;
    return file;
}

/**
 * The server knows a private room's photo only by its sealed name. Once this
 * page has the real file (it shared or opened it), keep the real name.
 */
export function withOpenedName(tile, photo) {
    if (!tile.secure || !(tile.isDecrypted || tile.seed) || !tile.fileName) return photo;
    if (photo.fileName === undefined || photo.fileName === tile.fileName) return photo;
    if (photo.isDecrypted) return photo;
    const { fileName, fileType, ...rest } = photo;
    return rest;
}
