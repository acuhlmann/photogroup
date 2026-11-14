import { describe, it, expect } from 'vitest';
import { createEncoder, createDecoder, blocksOfFrame } from './fountain';
import { createLightSender, createLightReceiver, readFrame, HEADER } from './lightFrames';

function bytesOf(length, salt = 1) {
    const out = new Uint8Array(length);
    let x = salt;
    for (let i = 0; i < length; i++) {
        x = (x * 1103515245 + 12345) & 0x7fffffff;
        out[i] = x >>> 16;
    }
    return out;
}

const same = (a, b) => Buffer.from(a).equals(Buffer.from(b));

describe('fountain', () => {
    it('gives the same blocks for a frame number each time', () => {
        expect(blocksOfFrame(3, 100)).toEqual([3]);
        expect(blocksOfFrame(1234, 100)).toEqual(blocksOfFrame(1234, 100));
        blocksOfFrame(1234, 100).forEach(index => expect(index).toBeLessThan(100));
    });

    it('needs no extra frames when none is lost', () => {
        const data = bytesOf(10000);
        const encoder = createEncoder(data, 100);
        const decoder = createDecoder(encoder.k, 100, data.length);
        for (let seed = 0; seed < encoder.k; seed++) decoder.add(seed, encoder.frame(seed));
        expect(decoder.done).toBe(true);
        expect(same(decoder.result(), data)).toBe(true);
    });

    it.each([[1, 40], [30, 200], [2100, 980]])('rebuilds %i blocks when the camera loses a third of the frames', (k, blockSize) => {
        const data = bytesOf(k * blockSize - 7, k);
        const encoder = createEncoder(data, blockSize);
        const decoder = createDecoder(encoder.k, blockSize, data.length);
        let seed = 0;
        let lost = 5;
        while (!decoder.done && seed < k * 4 + 60) {
            lost = (lost * 7 + 3) % 11;
            if (lost > 3) decoder.add(seed, encoder.frame(seed));
            seed++;
        }
        expect(decoder.done).toBe(true);
        expect(same(decoder.result(), data)).toBe(true);
        // The price of a channel with no way back: some frames more than blocks.
        expect(decoder.frames).toBeLessThan(k * 1.45 + 40);
    });

    it('rebuilds a file from late frames only', () => {
        const data = bytesOf(50000, 9);
        const encoder = createEncoder(data, 500);
        const decoder = createDecoder(encoder.k, 500, data.length);
        let seed = encoder.k;
        while (!decoder.done && seed < encoder.k * 4) decoder.add(seed, encoder.frame(seed++));
        expect(same(decoder.result(), data)).toBe(true);
        expect(decoder.frames).toBeLessThan(encoder.k * 1.5);
    });

    it('does not count a frame twice', () => {
        const encoder = createEncoder(bytesOf(1000), 100);
        const decoder = createDecoder(encoder.k, 100, 1000);
        expect(decoder.add(0, encoder.frame(0))).toBe(true);
        expect(decoder.add(0, encoder.frame(0))).toBe(false);
        expect(decoder.have).toBe(1);
    });
});

describe('lightFrames', () => {
    const details = { id: 'abc123', name: 'harbor.jpg', type: 'image/jpeg' };

    it('carries a photo and its details', () => {
        const file = bytesOf(30000, 4);
        const sender = createLightSender(details, file, 520);
        const receiver = createLightReceiver();
        let state = null;
        let shown = 0;
        for (; !state?.done; shown += 1) {
            const frame = sender.next();
            expect(frame.length).toBe(520);
            if (shown % 5 !== 2) state = receiver.add(frame);
        }
        // 60 blocks, one frame in five lost.
        expect(shown).toBeLessThan(sender.blocks * 2);
        expect(state.have).toBe(state.blocks);
        const result = receiver.result();
        expect(result.details).toEqual(details);
        expect(same(result.file, file)).toBe(true);
    });

    it('ignores other codes and damaged frames', () => {
        const sender = createLightSender(details, bytesOf(3000), 300);
        const frame = sender.frame(0);
        expect(readFrame(new TextEncoder().encode('https://photogroup.network/?room=abc'))).toBeNull();
        expect(readFrame(frame.subarray(0, 200))).toBeNull();
        const damaged = Uint8Array.from(frame);
        damaged[HEADER + 5] ^= 0x40;
        expect(readFrame(damaged)).toBeNull();
        expect(readFrame(frame).seed).toBe(0);
    });

    it('starts again when another photo comes on screen', () => {
        const receiver = createLightReceiver();
        const first = createLightSender(details, bytesOf(3000), 300, 1);
        const second = createLightSender({ ...details, id: 'other' }, bytesOf(900, 2), 300, 2);
        receiver.add(first.frame(0));
        let state = null;
        for (let seed = 0; !state?.done; seed++) state = receiver.add(second.frame(seed));
        expect(receiver.result().details.id).toBe('other');
    });
});

describe('estimates', () => {
    it('counts the extra codes a mixed stream needs', async () => {
        const { framesNeeded } = await import('./fountain');
        const { LIGHT_LEVELS, sendTimeText, levelRate } = await import('./lightSpeed');
        expect(framesNeeded(10)).toBe(10);
        expect(framesNeeded(200)).toBe(260);
        expect(framesNeeded(2000)).toBe(2280);
        const normal = LIGHT_LEVELS.find(level => level.id === 'normal');
        expect(levelRate(normal)).toBe(10560);
        // A 2 MB photo: about 3.5 minutes at Normal, about 1 minute at Fast.
        expect(sendTimeText(2000000, normal)).toBe('about 4 minutes');
        expect(sendTimeText(2000000, LIGHT_LEVELS.find(level => level.id === 'fast'))).toBe('about 65 seconds');
        expect(sendTimeText(4668, normal)).toBe('about 5 seconds');
    });

    it('shows the part received from the codes read', async () => {
        const { receivedPart } = await import('./LightReceive');
        expect(receivedPart({ have: 0, frames: 130, blocks: 200 })).toBe(0.5);
        expect(receivedPart({ have: 0, frames: 400, blocks: 200 })).toBe(0.99);
        expect(receivedPart({ have: 200, frames: 255, blocks: 200, done: true })).toBe(1);
    });
});

describe('limits', () => {
    it('refuses a stream that declares too many or too small blocks', () => {
        const frame = (total, blockSize) => {
            const out = new Uint8Array(HEADER + blockSize);
            const view = new DataView(out.buffer);
            out[0] = 0x50; out[1] = 0x4c; out[2] = 1;
            view.setUint32(8, total);
            view.setUint16(12, blockSize);
            view.setUint32(14, 0xffffffff);
            // The checksum of an all-zero block.
            let a = 1; let b = 0;
            for (let i = 0; i < blockSize; i++) { a = (a + 0) % 251; b = (b + a) % 251; }
            view.setUint16(18, (b << 8) | a);
            return out;
        };
        expect(readFrame(frame(880 * 50, 880))).not.toBeNull();
        expect(readFrame(frame(67108864, 1))).toBeNull();
        expect(readFrame(frame(67108864, 100))).toBeNull();
        expect(createLightReceiver().add(frame(67108864, 1))).toBeNull();
    });
});
