import { afterEach, describe, expect, it, vi } from 'vitest';
import { loadSmallImage, smallImageOf } from './smallImage';

describe('smallImage', () => {
    afterEach(() => vi.unstubAllGlobals());

    it('uses the preview that came with the share', async () => {
        const tile = { infoHash: 'p', isImage: true, previewUrl: 'blob:preview' };
        expect(smallImageOf(tile)).toBe('blob:preview');
        await expect(loadSmallImage(tile)).resolves.toBe('blob:preview');
    });

    it('makes a small copy once, scaled while decoding', async () => {
        const bitmap = { width: 341, height: 256, close: vi.fn() };
        const make = vi.fn(async () => bitmap);
        vi.stubGlobal('createImageBitmap', make);
        HTMLCanvasElement.prototype.getContext = () => ({ drawImage: () => {} });
        HTMLCanvasElement.prototype.toBlob = function (done) { done(new Blob(['x'], { type: 'image/jpeg' })); };
        URL.createObjectURL = vi.fn(() => 'blob:small');
        const tile = { infoHash: 'q', isImage: true, elem: new Blob(['photo'], { type: 'image/jpeg' }) };
        const [one, two] = await Promise.all([loadSmallImage(tile), loadSmallImage(tile)]);
        expect(one).toBe('blob:small');
        expect(two).toBe('blob:small');
        expect(make).toHaveBeenCalledTimes(1);
        expect(make.mock.calls[0][1]).toMatchObject({ resizeHeight: 256 });
        expect(bitmap.close).toHaveBeenCalled();
        expect(smallImageOf({ ...tile })).toBe('blob:small');
    });

    it('gives null when the browser cannot make one', async () => {
        vi.stubGlobal('createImageBitmap', async () => { throw new Error('no'); });
        const tile = { infoHash: 'r', isImage: true, elem: new Blob(['photo']) };
        await expect(loadSmallImage(tile)).resolves.toBe(null);
    });
});
