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

    it('uses the photo itself when it is no bigger than the copy asked for', async () => {
        photoOfSize(1200, 900);
        const make = vi.fn();
        vi.stubGlobal('createImageBitmap', make);
        const tile = { infoHash: 'u', isImage: true, img: 'blob:photo', elem: new Blob(['photo'], { type: 'image/jpeg' }) };
        await expect(loadSmallImage(tile, 2048)).resolves.toBe('blob:photo');
        expect(make).not.toHaveBeenCalled();
        expect(smallImageOf(tile, 2048)).toBe('blob:photo');
        await expect(loadSmallImage(tile, 2048)).resolves.toBe('blob:photo');
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

    it('makes the copy of the photo on screen before copies asked for earlier', async () => {
        photoOfSize(4000, 3000);
        const started = [];
        vi.stubGlobal('createImageBitmap', blob => new Promise(resolve => started.push({ name: blob.name, done: resolve })));
        HTMLCanvasElement.prototype.getContext = () => ({ drawImage: () => {} });
        HTMLCanvasElement.prototype.toBlob = function (done) { done(new Blob(['x'])); };
        URL.createObjectURL = vi.fn(() => 'blob:copy');
        const tile = name => ({ infoHash: 'queue-' + name, isImage: true, elem: Object.assign(new Blob([name]), { name }) });
        const settle = () => new Promise(resolve => setTimeout(resolve, 10));
        const finish = async name => {
            started.find(job => job.name === name).done({ width: 10, height: 10, close: () => {} });
            await settle();
        };
        // Two at a time: a and b start, c and d wait.
        ['a', 'b', 'c', 'd'].forEach(name => loadSmallImage(tile(name), 1024));
        await settle();
        expect(started.map(job => job.name)).toEqual(['a', 'b']);
        // d is now on screen: it goes before c.
        loadSmallImage(tile('d'), 1024, { urgent: true });
        // e is new and on screen: it goes first of all.
        loadSmallImage(tile('e'), 1024, { urgent: true });
        await finish('a');
        await finish('b');
        expect(started.map(job => job.name)).toEqual(['a', 'b', 'e', 'd']);
        await finish('e');
        expect(started.map(job => job.name)).toEqual(['a', 'b', 'e', 'd', 'c']);
        await finish('d');
        await finish('c');
    });

    // Each is 200 MB of pixels while it decodes: two at once made a phone let go of the photo shown.
    it('decodes photos over 24 megapixels one at a time', async () => {
        photoOfSize(8160, 6120);
        const started = [];
        vi.stubGlobal('createImageBitmap', blob => new Promise(resolve => started.push({ name: blob.name, done: resolve })));
        HTMLCanvasElement.prototype.getContext = () => ({ drawImage: () => {} });
        HTMLCanvasElement.prototype.toBlob = function (done) { done(new Blob(['x'])); };
        URL.createObjectURL = vi.fn(() => 'blob:copy');
        const tile = name => ({ infoHash: 'big-' + name, isImage: true, elem: Object.assign(new Blob([name]), { name }) });
        const settle = () => new Promise(resolve => setTimeout(resolve, 10));
        const copies = ['a', 'b'].map(name => loadSmallImage(tile(name), 2048));
        await settle();
        expect(started.map(job => job.name)).toEqual(['a']);
        started[0].done({ width: 10, height: 10, close: () => {} });
        await settle();
        expect(started.map(job => job.name)).toEqual(['a', 'b']);
        started[1].done({ width: 10, height: 10, close: () => {} });
        await expect(Promise.all(copies)).resolves.toEqual(['blob:copy', 'blob:copy']);
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
