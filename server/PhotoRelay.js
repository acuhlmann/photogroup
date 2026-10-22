/**
 * PhotoRelay - temporary server copy ("pin") of a photo, the last fallback
 * tier when P2P, TURN included, can't connect two phones (carrier CGNAT,
 * venue Wi-Fi client isolation, the only holder's phone asleep...).
 *
 * The app is meant to move photos browser to browser, so a copy is only
 * pinned when someone needs it (see the routes in Rooms.js) and goes away
 * as soon as nobody does: once everyone in the room has the photo, at the
 * latest after COPY_TTL_MS, or with the photo. Copies are written to a
 * scratch directory wiped at startup (the production VM has 1 GB of RAM),
 * uploaded in chunks a phone can resume after being backgrounded, and
 * bounded per file, per room and in total.
 */
import fs from 'fs';
import fsp from 'fs/promises';
import os from 'os';
import path from 'path';
import { createHash } from 'crypto';

const MiB = 1024 * 1024;
export const MAX_PHOTO_BYTES = 100 * MiB;
export const MAX_ROOM_BYTES = 1024 * MiB;
export const MAX_TOTAL_BYTES = Number(process.env.RELAY_MAX_TOTAL_BYTES) || 2048 * MiB;
// Under Cloud Run's 32 MiB request cap and nginx's client_max_body_size.
export const MAX_CHUNK_BYTES = 8 * MiB;
export const COPY_TTL_MS = 24 * 60 * 60 * 1000;
// An uploader that has sent nothing for this long (its phone went to sleep)
// lets another holder carry on from the same byte.
export const UPLOAD_LEASE_MS = 60 * 1000;
export const STALE_UPLOAD_MS = 10 * 60 * 1000;

export function defaultRelayDir() {
    if (process.env.RELAY_DIR) return process.env.RELAY_DIR;
    const name = process.env.NODE_ENV === 'test' ? 'photogroup-relay-test-' + process.pid : 'photogroup-relay';
    return path.join(os.tmpdir(), name);
}

/**
 * `code` says what went wrong: TOO_LARGE / QUOTA (413), EXISTS, BUSY and
 * OFFSET (409; OFFSET carries `received` so the uploader can resume),
 * INVALID (400).
 */
export class RelayError extends Error {
    constructor(code, message, extra = {}) {
        super(message);
        this.code = code;
        Object.assign(this, extra);
    }
}

export default class PhotoRelay {
    constructor({
        dir = defaultRelayDir(),
        maxPhotoBytes = MAX_PHOTO_BYTES,
        maxRoomBytes = MAX_ROOM_BYTES,
        maxTotalBytes = MAX_TOTAL_BYTES,
        ttlMs = COPY_TTL_MS,
        leaseMs = UPLOAD_LEASE_MS,
        staleUploadMs = STALE_UPLOAD_MS,
        now = () => Date.now(),
    } = {}) {
        dir = path.resolve(dir);
        Object.assign(this, { dir, maxPhotoBytes, maxRoomBytes, maxTotalBytes, ttlMs, leaseMs, staleUploadMs, now });
        this.copies = new Map(); // key(roomId, infoHash) -> entry
        this.totalBytes = 0; // reserved by every upload, finished or not
        // Copies are temporary: whatever a previous process left is stale.
        fs.rmSync(dir, { recursive: true, force: true });
        fs.mkdirSync(dir, { recursive: true });
    }

    static key(roomId, infoHash) {
        return roomId + '\n' + infoHash;
    }

    roomBytes(roomId) {
        let bytes = 0;
        this.copies.forEach(entry => { if (entry.roomId === roomId) bytes += entry.size; });
        return bytes;
    }

    /** Status of a copy, finished or still uploading, or null. */
    status(roomId, infoHash) {
        return this.copies.get(PhotoRelay.key(roomId, infoHash)) || null;
    }

    /** A finished copy, or null. */
    get(roomId, infoHash) {
        const entry = this.status(roomId, infoHash);
        return entry?.complete ? entry : null;
    }

    has(roomId, infoHash) {
        return !!this.get(roomId, infoHash);
    }

    /**
     * Write one chunk at `offset` of a file `size` bytes long. The first
     * chunk reserves quota for the whole file. Resolves to the entry.
     */
    async append(roomId, infoHash, { offset, size, buffer, uploader, contentType }) {
        if (!Number.isSafeInteger(offset) || offset < 0 || !Number.isSafeInteger(size) || size <= 0) {
            throw new RelayError('INVALID', 'Expected offset and size');
        }
        if (!buffer?.length) throw new RelayError('INVALID', 'Expected photo bytes');
        if (offset + buffer.length > size) throw new RelayError('INVALID', 'Chunk runs past the declared size');
        if (size > this.maxPhotoBytes) {
            throw new RelayError('TOO_LARGE', `Photos over ${Math.round(this.maxPhotoBytes / MiB)} MB aren't kept on the server`);
        }
        const key = PhotoRelay.key(roomId, infoHash);
        let entry = this.copies.get(key);
        const now = this.now();

        if (entry?.complete) throw new RelayError('EXISTS', 'Server copy already exists');
        if (entry && entry.size !== size) throw new RelayError('INVALID', 'Size differs from the upload in progress');
        if (entry && entry.uploader !== uploader) {
            // Any holder uploads the same bytes, so another one may carry on
            // where a sleeping uploader stopped.
            if (now - entry.lastChunkAt < this.leaseMs) {
                throw new RelayError('BUSY', 'Someone else is uploading this photo', { uploader: entry.uploader });
            }
            entry.uploader = uploader;
        }
        if (entry?.writing) throw new RelayError('BUSY', 'A chunk is being written', { uploader: entry.uploader });

        if (!entry) {
            if (offset !== 0) throw new RelayError('OFFSET', 'Start from the beginning', { received: 0 });
            if (this.roomBytes(roomId) + size > this.maxRoomBytes) {
                throw new RelayError('QUOTA', "This room's server copies are full");
            }
            if (this.totalBytes + size > this.maxTotalBytes) {
                throw new RelayError('QUOTA', 'The server is full right now');
            }
            const file = path.join(this.dir, createHash('sha256').update(key).digest('hex'));
            entry = {
                roomId, infoHash, file, size, received: 0,
                contentType: contentType || 'application/octet-stream',
                uploader, startedAt: now, lastChunkAt: now,
                complete: false, completedAt: null, writing: false,
            };
            this.copies.set(key, entry);
            this.totalBytes += size;
        }
        if (offset !== entry.received) {
            throw new RelayError('OFFSET', 'Resume from byte ' + entry.received, { received: entry.received });
        }

        entry.writing = true;
        try {
            const handle = await fsp.open(entry.file, offset === 0 ? 'w' : 'r+');
            try {
                await handle.write(buffer, 0, buffer.length, offset);
            } finally {
                await handle.close();
            }
        } finally {
            entry.writing = false;
        }
        // Deleted (photo removed, room reset) while writing.
        if (this.copies.get(key) !== entry) throw new RelayError('INVALID', 'Photo was removed');

        entry.received = offset + buffer.length;
        entry.lastChunkAt = this.now();
        if (entry.received === entry.size) {
            entry.complete = true;
            entry.completedAt = entry.lastChunkAt;
        }
        return entry;
    }

    delete(roomId, infoHash) {
        const key = PhotoRelay.key(roomId, infoHash);
        const entry = this.copies.get(key);
        if (!entry) return false;
        this.copies.delete(key);
        this.totalBytes -= entry.size;
        fs.rm(entry.file, { force: true }, () => {});
        return true;
    }

    deleteRoom(roomId) {
        [...this.copies.values()]
            .filter(entry => entry.roomId === roomId)
            .forEach(entry => this.delete(roomId, entry.infoHash));
    }

    /** Drop copies past their time and uploads abandoned midway; return them. */
    sweep() {
        const now = this.now();
        const expired = [...this.copies.values()].filter(entry => entry.complete
            ? now - entry.completedAt >= this.ttlMs
            : now - entry.lastChunkAt >= this.staleUploadMs);
        expired.forEach(entry => this.delete(entry.roomId, entry.infoHash));
        return expired;
    }

    clear() {
        [...this.copies.values()].forEach(entry => this.delete(entry.roomId, entry.infoHash));
    }
}
