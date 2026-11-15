import { createEncoder, createDecoder } from './fountain.js';

// What one code on the screen holds when a photo goes from screen to camera:
// a 20-byte header and one fountain frame. The stream that the frames carry
// is [length of details][details as JSON][the file].

export const HEADER = 20;
const MAGIC = [0x50, 0x4c]; // "PL"
const VERSION = 1;
// The largest file a camera transfer takes: it has to fit in memory twice.
export const MAX_LIGHT_BYTES = 64 * 1024 * 1024;
// A code from a stranger's screen must not make this phone set aside a lot
// of memory: the smallest block and the most blocks a stream can declare.
export const MIN_BLOCK_BYTES = 100;
export const MAX_BLOCKS = 200000;

function checksum(bytes) {
    let a = 1;
    let b = 0;
    for (let i = 0; i < bytes.length; i++) {
        a = (a + bytes[i]) % 251;
        b = (b + a) % 251;
    }
    return (b << 8) | a;
}

/**
 * A stable name for one stream, from its details and a sample of its bytes.
 * The same photo sent again gets the same name, so a receiver that already
 * holds some of its blocks can carry on instead of starting from nothing:
 * the blocks themselves are made from the stream alone, so blocks from the
 * first try and blocks from the second fit together. A random name (what
 * this used) threw away everything the camera had read whenever the sender
 * was closed and reopened, or its codes were rebuilt.
 */
export function lightSendId(details, file) {
    const meta = new TextEncoder().encode(JSON.stringify(details));
    let hash = 0x811c9dc5;
    const mix = (byte) => { hash = Math.imul(hash ^ byte, 0x01000193) >>> 0; };
    for (const byte of meta) mix(byte);
    // The length, then the start, middle and end of the file.
    const length = file.length;
    for (let shift = 24; shift >= 0; shift -= 8) mix((length >>> shift) & 0xff);
    const sample = Math.min(8192, length);
    const starts = [0, Math.max(0, (length >> 1) - (sample >> 1)), Math.max(0, length - sample)];
    for (const start of starts) {
        for (let i = start; i < start + sample; i++) mix(file[i]);
    }
    // Zero is a fine name too, but keep the value clearly a name.
    return hash || 1;
}

/**
 * The frames of one photo.
 * @param {{id: string, name: string, type: string}} details which room photo this is
 * @param {Uint8Array} file the photo's bytes as its torrent carries them
 * @param {number} frameBytes bytes per code, header included
 * @param {number} [sendId] the stream's name; the stable one above when left out
 */
export function createLightSender(details, file, frameBytes, sendId) {
    const meta = new TextEncoder().encode(JSON.stringify(details));
    // The length of the details is two bytes: longer ones would be cut, and the file with them.
    if (meta.length > 0xffff) throw new RangeError('The details are too long for a camera transfer');
    const stream = new Uint8Array(2 + meta.length + file.length);
    new DataView(stream.buffer).setUint16(0, meta.length);
    stream.set(meta, 2);
    stream.set(file, 2 + meta.length);
    if (sendId === undefined) sendId = lightSendId(details, file);
    const blockSize = frameBytes - HEADER;
    const encoder = createEncoder(stream, blockSize);
    // A small file goes block by block first. A large one goes mixed from
    // the start: when the camera loses frames, that needs fewer frames in all.
    const first = encoder.k < 64 ? 0 : encoder.k;
    let shown = 0;
    return {
        blocks: encoder.k,
        bytes: stream.length,
        /** The next code to show. */
        next() {
            return this.frame(first + shown++);
        },
        /** The bytes of code number `seed`. */
        frame(seed) {
            const payload = encoder.frame(seed);
            const out = new Uint8Array(HEADER + blockSize);
            const view = new DataView(out.buffer);
            out[0] = MAGIC[0];
            out[1] = MAGIC[1];
            out[2] = VERSION;
            view.setUint32(4, sendId);
            view.setUint32(8, stream.length);
            view.setUint16(12, blockSize);
            view.setUint32(14, seed);
            view.setUint16(18, checksum(payload));
            out.set(payload, HEADER);
            return out;
        },
    };
}

/** The header of a code, or null when it is not one of ours or is damaged. */
export function readFrame(bytes) {
    if (!bytes || bytes.length <= HEADER || bytes[0] !== MAGIC[0] || bytes[1] !== MAGIC[1] || bytes[2] !== VERSION) return null;
    const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
    const blockSize = view.getUint16(12);
    const total = view.getUint32(8);
    if (bytes.length !== HEADER + blockSize || !total || total > MAX_LIGHT_BYTES + 4096) return null;
    if (blockSize < MIN_BLOCK_BYTES || Math.ceil(total / blockSize) > MAX_BLOCKS) return null;
    const payload = bytes.subarray(HEADER);
    if (checksum(payload) !== view.getUint16(18)) return null;
    return { sendId: view.getUint32(4), total, blockSize, seed: view.getUint32(14), payload };
}

/**
 * Takes codes as the camera reads them. It follows one send: when another
 * photo comes on screen, it starts again.
 */
export function createLightReceiver() {
    let current = null;
    return {
        /** @returns {{have: number, frames: number, blocks: number, total: number, fresh: boolean, done: boolean}|null} */
        add(bytes) {
            const frame = readFrame(bytes);
            if (!frame) return null;
            if (!current || current.sendId !== frame.sendId || current.total !== frame.total || current.blockSize !== frame.blockSize) {
                current = {
                    sendId: frame.sendId,
                    total: frame.total,
                    blockSize: frame.blockSize,
                    decoder: createDecoder(Math.ceil(frame.total / frame.blockSize), frame.blockSize, frame.total),
                };
            }
            const fresh = current.decoder.add(frame.seed, frame.payload);
            return {
                sendId: current.sendId,
                have: current.decoder.have,
                frames: current.decoder.frames,
                blocks: current.decoder.k,
                total: current.total,
                fresh,
                done: current.decoder.done,
            };
        },
        /** What is held so far, or null before the first code of a send. */
        progress() {
            if (!current) return null;
            return {
                sendId: current.sendId,
                have: current.decoder.have,
                frames: current.decoder.frames,
                blocks: current.decoder.k,
                total: current.total,
                done: current.decoder.done,
            };
        },
        /** `{ details, file }` once done, or null. */
        result() {
            const stream = current?.decoder.result();
            if (!stream) return null;
            try {
                const length = new DataView(stream.buffer, stream.byteOffset, stream.byteLength).getUint16(0);
                const details = JSON.parse(new TextDecoder().decode(stream.subarray(2, 2 + length)));
                return { details, file: stream.slice(2 + length) };
            } catch {
                return null;
            }
        },
        reset() {
            current = null;
        },
    };
}

let sharedReceiver = null;

/**
 * The one receiver this page keeps, however often the camera dialog is
 * closed and opened again. Its blocks used to live in the dialog, so a
 * second try started at nothing even when the first had nearly finished;
 * now closing the dialog (or the camera restarting) keeps what was read,
 * and the same photo shown again carries on from there. A different photo
 * still starts again, because its stream has another name or size.
 */
export function getSharedLightReceiver() {
    if (!sharedReceiver) sharedReceiver = createLightReceiver();
    return sharedReceiver;
}

/** Forget what the shared receiver holds. For tests, and after a photo is in. */
export function resetSharedLightReceiver() {
    sharedReceiver?.reset();
    sharedReceiver = null;
}
