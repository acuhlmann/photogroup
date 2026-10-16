/**
 * PhotoRelay - temporary server-side copy of a photo, the fallback tier
 * when P2P cannot connect two phones (carrier CGNAT, venue Wi-Fi client
 * isolation, uploader's screen locked after sharing...).
 *
 * Deliberately in-memory like everything else in this app: a copy lives
 * only while its room/photo lives, is dropped when the photo is deleted,
 * and is bounded per file and per room so a room cannot fill the disk/RAM
 * of the small production VM.
 */
export const MAX_PHOTO_BYTES = 32 * 1024 * 1024; // one large phone photo / short clip
export const MAX_ROOM_BYTES = 256 * 1024 * 1024;

export class PhotoTooLargeError extends Error {
    constructor(message) { super(message); this.code = 'PHOTO_TOO_LARGE'; }
}

export default class PhotoRelay {
    constructor({ maxPhotoBytes = MAX_PHOTO_BYTES, maxRoomBytes = MAX_ROOM_BYTES } = {}) {
        this.maxPhotoBytes = maxPhotoBytes;
        this.maxRoomBytes = maxRoomBytes;
        this.copies = new Map(); // infoHash -> {buffer, contentType, size}
        this.totalBytes = 0;
    }

    put(infoHash, buffer, contentType) {
        if (!infoHash || !buffer?.length) throw new PhotoTooLargeError('Empty photo copy');
        if (buffer.length > this.maxPhotoBytes) {
            throw new PhotoTooLargeError(`Photo copy exceeds ${this.maxPhotoBytes} bytes`);
        }
        const previous = this.copies.get(infoHash);
        const previousSize = previous ? previous.size : 0;
        if (this.totalBytes - previousSize + buffer.length > this.maxRoomBytes) {
            throw new PhotoTooLargeError('Room server-copy quota exceeded');
        }
        this.copies.set(infoHash, { buffer, contentType: contentType || 'application/octet-stream', size: buffer.length });
        this.totalBytes += buffer.length - previousSize;
        return { size: buffer.length, contentType: contentType || 'application/octet-stream' };
    }

    get(infoHash) {
        return this.copies.get(infoHash) || null;
    }

    has(infoHash) {
        return this.copies.has(infoHash);
    }

    delete(infoHash) {
        const previous = this.copies.get(infoHash);
        if (!previous) return false;
        this.totalBytes -= previous.size;
        this.copies.delete(infoHash);
        return true;
    }

    clear() {
        this.copies.clear();
        this.totalBytes = 0;
    }
}
