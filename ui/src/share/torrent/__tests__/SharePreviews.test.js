import { describe, expect, it, vi } from 'vitest';
import TorrentAddition from '../TorrentAddition';

const jpeg = name => new File([new Uint8Array([0xff, 0xd8, 0xff, 0xe0, 1, 2])], 'Thumbnail ' + name, { type: '' });

/** The previews a share hands to the room, by infoHash. */
async function sent(photos) {
    const sharePoster = vi.fn(async () => ({}));
    const addition = new TorrentAddition({}, {}, { on: vi.fn() }, { service: { sharePoster } });
    await addition.sharePreviews(photos);
    return sharePoster.mock.calls;
}

describe('previews through the room', () => {
    it('sends each photo its own preview as a JPEG data URL', async () => {
        const thumbs = [jpeg('a.jpg'), jpeg('b.jpg')];
        const calls = await sent([
            { infoHash: 'h1', fileName: 'a.jpg', thumbnailFiles: thumbs },
            { infoHash: 'h2', fileName: 'b.jpg', thumbnailFiles: thumbs },
        ]);
        expect(calls.map(call => call[0]).sort()).toEqual(['h1', 'h2']);
        calls.forEach(call => expect(call[1]).toMatch(/^data:image\/jpeg;base64,\/9j\//));
    });

    it('never sends a private photo, one without a preview, or a large one', async () => {
        const big = new Uint8Array(60 * 1024);
        big.set([0xff, 0xd8, 0xff]);
        const calls = await sent([
            { infoHash: 'p', fileName: 'p.jpg', secure: true, thumbnailFiles: [jpeg('p.jpg')] },
            { infoHash: 'n', fileName: 'n.jpg', thumbnailFiles: [] },
            { infoHash: 'big', fileName: 'big.jpg', thumbnailFiles: [new File([big], 'Thumbnail big.jpg')] },
        ]);
        expect(calls).toEqual([]);
    });

    it('makes a PNG preview into a JPEG', async () => {
        const png = new File([new Uint8Array([0x89, 0x50, 0x4e, 0x47, 1, 2])], 'Thumbnail c.png');
        vi.stubGlobal('createImageBitmap', async () => ({ width: 4, height: 3, close: () => {} }));
        HTMLCanvasElement.prototype.getContext = () => ({ fillRect: () => {}, drawImage: () => {} });
        HTMLCanvasElement.prototype.toBlob = function (done, type) {
            done(new Blob([new Uint8Array([0xff, 0xd8, 0xff, 0xdb])], { type }));
        };
        const calls = await sent([{ infoHash: 'c', fileName: 'c.png', thumbnailFiles: [png] }]);
        expect(calls).toHaveLength(1);
        expect(calls[0][1]).toMatch(/^data:image\/jpeg;base64,\/9j\//);
        vi.unstubAllGlobals();
    });
});
