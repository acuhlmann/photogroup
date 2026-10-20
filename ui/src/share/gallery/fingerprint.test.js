import { describe, it, expect, vi } from 'vitest';
import { fingerprintFile, fingerprintSize } from './fingerprint';

const MB = 1024 * 1024;

/** Deterministic bytes, different for each seed. */
function bytes(length, seed = 1) {
    const out = new Uint8Array(length);
    let state = seed;
    for (let i = 0; i < length; i++) {
        state = (state * 1103515245 + 12345) >>> 0;
        out[i] = state >>> 24;
    }
    return out;
}

describe('fingerprintFile', () => {
    it('is the same for the same bytes, whatever the file is called', async () => {
        const data = bytes(3 * MB);
        const a = await fingerprintFile(new File([data], 'IMG_1.jpg'));
        const b = await fingerprintFile(new File([data], 'renamed.jpg'));
        expect(a).toBe(b);
        expect(a).toMatch(/^3145728:[0-9a-f]{64}$/);
        expect(fingerprintSize(a)).toBe(3 * MB);
    });

    it('tells apart files that differ at the start, middle or end', async () => {
        const data = bytes(3 * MB);
        const base = await fingerprintFile(new Blob([data]));
        for (const at of [10, Math.floor(data.length / 2), data.length - 10]) {
            const changed = data.slice();
            changed[at] ^= 0xFF;
            expect(await fingerprintFile(new Blob([changed]))).not.toBe(base);
        }
        expect(await fingerprintFile(new Blob([data.slice(0, -1)]))).not.toBe(base);
    });

    it('reads only three samples of a big file', async () => {
        const file = new Blob([bytes(8 * MB)]);
        const slice = vi.spyOn(file, 'slice');
        await fingerprintFile(file);
        expect(slice).toHaveBeenCalledTimes(3);
        expect(slice.mock.calls.every(([start, end]) => end - start === 256 * 1024)).toBe(true);
    });

    it('hashes a small file whole', async () => {
        const data = bytes(1000);
        const changed = data.slice();
        changed[500] ^= 1;
        expect(await fingerprintFile(new Blob([data]))).not.toBe(await fingerprintFile(new Blob([changed])));
    });

    it('gives null without WebCrypto or a file', async () => {
        expect(await fingerprintFile(null)).toBeNull();
        const subtle = vi.spyOn(globalThis.crypto, 'subtle', 'get').mockReturnValue(undefined);
        expect(await fingerprintFile(new Blob([bytes(10)]))).toBeNull();
        subtle.mockRestore();
    });

    it('reads sizes only from real fingerprints', () => {
        expect(fingerprintSize('12:' + 'a'.repeat(64))).toBe(12);
        expect(fingerprintSize('12:abc')).toBeNaN();
        expect(fingerprintSize(undefined)).toBeNaN();
    });
});
