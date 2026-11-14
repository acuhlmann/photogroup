import { createEncoder, createDecoder } from './fountain.js';

// What one code on the screen holds when a photo goes from screen to camera:
// a 20-byte header and one fountain frame. The stream that the frames carry
// is [length of details][details as JSON][the file].

export const HEADER = 20;
const MAGIC = [0x50, 0x4c]; // "PL"
const VERSION = 1;
// The largest file a camera transfer takes: it has to fit in memory twice.
export const MAX_LIGHT_BYTES = 64 * 1024 * 1024;

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
 * The frames of one photo.
 * @param {{id: string, name: string, type: string}} details which room photo this is
 * @param {Uint8Array} file the photo's bytes as its torrent carries them
 * @param {number} frameBytes bytes per code, header included
 */
export function createLightSender(details, file, frameBytes, sendId = (Math.random() * 0xffffffff) >>> 0) {
    const meta = new TextEncoder().encode(JSON.stringify(details));
    const stream = new Uint8Array(2 + meta.length + file.length);
    new DataView(stream.buffer).setUint16(0, meta.length);
    stream.set(meta, 2);
    stream.set(file, 2 + meta.length);
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
                have: current.decoder.have,
                frames: current.decoder.frames,
                blocks: current.decoder.k,
                total: current.total,
                fresh,
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
