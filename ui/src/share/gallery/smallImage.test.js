import { afterEach, describe, expect, it, vi } from 'vitest';
import { copySize, loadSmallImage, smallImageOf } from './smallImage';

/** An Image that knows the photo's size as soon as it has a source. */
function photoOfSize(width, height) {
    vi.stubGlobal('Image', class {
        set src(value) {
            this.naturalWidth = width;
            this.naturalHeight = height;
            setTimeout(() => this.onload && this.onload());
        }
    });
    URL.revokeObjectURL = vi.fn();
}

describe('smallImage', () => {
    afterEach(() => vi.unstubAllGlobals());

    it('uses the preview that came with the share', async () => {
        const tile = { infoHash: 'p', isImage: true, previewUrl: 'blob:preview' };
        expect(smallImageOf(tile)).toBe('blob:preview');
        await expect(loadSmallImage(tile)).resolves.toBe('blob:preview');
    });

    it('makes a small copy once, scaled while decoding', async () => {
        photoOfSize(4000, 3000);
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
        photoOfSize(4000, 3000);
        vi.stubGlobal('createImageBitmap', async () => { throw new Error('no'); });
        const tile = { infoHash: 'r', isImage: true, elem: new Blob(['photo']) };
        await expect(loadSmallImage(tile)).resolves.toBe(null);
    });

    it('makes a larger copy for the grid apart from the list one', async () => {
        photoOfSize(4000, 3000);
        const make = vi.fn(async () => ({ width: 853, height: 640, close: () => {} }));
        vi.stubGlobal('createImageBitmap', make);
        HTMLCanvasElement.prototype.getContext = () => ({ drawImage: () => {} });
        HTMLCanvasElement.prototype.toBlob = function (done) { done(new Blob(['x'])); };
        URL.createObjectURL = vi.fn(() => 'blob:grid');
        const tile = { infoHash: 's', isImage: true, previewUrl: 'blob:preview', elem: new Blob(['photo']) };
        expect(smallImageOf(tile)).toBe('blob:preview');
        expect(smallImageOf(tile, 640)).toBe(null);
        await expect(loadSmallImage(tile, 640)).resolves.toBe('blob:grid');
        expect(make.mock.calls[0][1]).toMatchObject({ resizeHeight: 640 });
    });

    it('scales the short side, and a panorama by its long side', () => {
        expect(copySize({ width: 4000, height: 3000 }, 640)).toEqual({ resizeHeight: 640 });
        expect(copySize({ width: 3000, height: 4000 }, 640)).toEqual({ resizeWidth: 640 });
        expect(copySize({ width: 20000, height: 100 }, 640)).toEqual({ resizeWidth: 2560 });
        expect(copySize({ width: 100, height: 20000 }, 640)).toEqual({ resizeHeight: 2560 });
        expect(copySize({ width: 300, height: 200 }, 640)).toEqual({});
    });

    it('keeps a see-through photo see-through', async () => {
        photoOfSize(1000, 1000);
        vi.stubGlobal('createImageBitmap', async () => ({ width: 256, height: 256, close: () => {} }));
        HTMLCanvasElement.prototype.getContext = () => ({ drawImage: () => {} });
        const types = [];
        HTMLCanvasElement.prototype.toBlob = function (done, type) { types.push(type); done(new Blob(['x'])); };
        URL.createObjectURL = vi.fn(() => 'blob:clear');
        await loadSmallImage({ infoHash: 't', isImage: true, elem: new Blob(['photo'], { type: 'image/png' }) });
        expect(types).toEqual(['image/webp']);
    });

    it('makes no copy when the size cannot be read', async () => {
        vi.stubGlobal('Image', class {
            set src(value) { setTimeout(() => this.onerror && this.onerror()); }
        });
        URL.revokeObjectURL = vi.fn();
        URL.createObjectURL = vi.fn(() => 'blob:probe');
        const make = vi.fn(async () => ({ width: 1, height: 1, close: () => {} }));
        vi.stubGlobal('createImageBitmap', make);
        await expect(loadSmallImage({ infoHash: 'u', isImage: true, elem: new Blob(['photo']) }, 640)).resolves.toBe(null);
        expect(make).not.toHaveBeenCalled();
    });
});
