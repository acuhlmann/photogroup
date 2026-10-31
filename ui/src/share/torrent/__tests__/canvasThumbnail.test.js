import { describe, it, expect, vi, afterEach } from 'vitest';
import { createCanvasThumbnail } from '../ThumbnailExtractor';

describe('createCanvasThumbnail', () => {
    afterEach(() => {
        vi.restoreAllMocks();
        delete globalThis.createImageBitmap;
    });

    it('decodes with createImageBitmap and scales the long side to the limit', async () => {
        const bitmap = { width: 3000, height: 2000, close: vi.fn() };
        globalThis.createImageBitmap = vi.fn().mockResolvedValue(bitmap);
        const drawImage = vi.fn();
        const canvas = {
            width: 0, height: 0,
            getContext: () => ({ drawImage }),
            toBlob: (cb) => cb(new Blob(['x'], { type: 'image/jpeg' })),
        };
        const realCreate = document.createElement.bind(document);
        vi.spyOn(document, 'createElement').mockImplementation(tag => tag === 'canvas' ? canvas : realCreate(tag));
        vi.spyOn(URL, 'createObjectURL').mockReturnValue('blob:thumb');

        const file = new File(['data'], 'a.jpg', { type: 'image/jpeg' });
        const url = await createCanvasThumbnail(file, 200);

        expect(url).toBe('blob:thumb');
        expect(globalThis.createImageBitmap).toHaveBeenCalledWith(file, { imageOrientation: 'from-image' });
        expect(canvas.width).toBe(200);
        expect(canvas.height).toBe(133);
        expect(drawImage).toHaveBeenCalledWith(bitmap, 0, 0, 200, 133);
        expect(bitmap.close).toHaveBeenCalled();
    });
});
