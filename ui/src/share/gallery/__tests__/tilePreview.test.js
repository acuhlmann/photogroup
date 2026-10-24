import { describe, it, expect, vi, beforeEach } from 'vitest';
import { loadPreviewUrl, previewUrlOf } from '../tilePreview';

describe('tilePreview', () => {
    beforeEach(() => {
        let made = 0;
        URL.createObjectURL = vi.fn(() => 'blob:preview-' + (++made));
    });

    it('uses the thumbnail this device shared for the tile', () => {
        const thumb = new File(['jpeg'], 'Thumbnail beach.mp4', { type: 'image/jpeg' });
        const tile = { infoHash: 'shared', fileName: 'beach.mp4', thumbnailFiles: [new File(['x'], 'Thumbnail other.jpg'), thumb] };
        expect(previewUrlOf(tile)).toBe('blob:preview-1');
        expect(URL.createObjectURL).toHaveBeenCalledWith(thumb);
        // Kept on the tile, so a re-render reuses it.
        expect(previewUrlOf(tile)).toBe('blob:preview-1');
        expect(URL.createObjectURL).toHaveBeenCalledTimes(1);
    });

    it('fetches the thumbnail from the torrent once, for every copy of the tile', async () => {
        const blob = vi.fn(async () => new Blob(['jpeg'], { type: 'video/mp4' }));
        const tile = { infoHash: 'received', fileName: 'beach.mp4', torrentFileThumb: { blob } };
        const [first, second] = await Promise.all([loadPreviewUrl(tile), loadPreviewUrl({ ...tile })]);
        expect(first).toBe('blob:preview-1');
        expect(second).toBe('blob:preview-1');
        expect(blob).toHaveBeenCalledTimes(1);
        // Typed by its name as a video: the type is dropped so it shows as a picture.
        expect(URL.createObjectURL.mock.calls[0][0].type).toBe('');
        expect(previewUrlOf({ infoHash: 'received' })).toBe('blob:preview-1');
    });

    it('has none for encrypted shares or when the thumbnail fails', async () => {
        const failing = { blob: async () => { throw new Error('destroyed'); } };
        expect(await loadPreviewUrl({ infoHash: 's', secure: true, torrentFileThumb: failing })).toBeNull();
        expect(await loadPreviewUrl({ infoHash: 'f', torrentFileThumb: failing })).toBeNull();
        expect(await loadPreviewUrl({ infoHash: 'n' })).toBeNull();
    });
});
