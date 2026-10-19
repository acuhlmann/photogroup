import { describe, it, expect, vi, beforeEach } from 'vitest';
import TorrentAddition, { readFileBlob } from '../TorrentAddition';
import { cachePut } from '../../util/ImageBlobCache';

vi.mock('../../util/ImageBlobCache', () => ({
    cachePut: vi.fn().mockResolvedValue(),
    shouldCacheBlob: type => typeof type === 'string' && type.startsWith('image/'),
}));

const webtorrent3File = (name, path, type) => ({
    name, path, type,
    blob: vi.fn().mockResolvedValue(new Blob([name], { type })),
});

describe('readFileBlob', () => {
    it('uses WebTorrent 3 blob()', async () => {
        const file = webtorrent3File('a.jpg', 'a.jpg', 'image/jpeg');
        expect((await readFileBlob(file)).type).toBe('image/jpeg');
    });

    it('falls back to the older getBlob callback', async () => {
        const blob = new Blob(['x'], { type: 'image/png' });
        expect(await readFileBlob({ getBlob: cb => cb(null, blob) })).toBe(blob);
    });

    it('resolves null when the file can be read neither way', async () => {
        expect(await readFileBlob({})).toBeNull();
    });
});

describe('receiver blob cache', () => {
    beforeEach(() => cachePut.mockClear());

    it('caches every downloaded photo of a multi-file torrent under its compound hash', async () => {
        const addition = new TorrentAddition({}, {}, { on: vi.fn() }, {});
        await addition.done({
            infoHash: 'base', name: 'folder',
            files: [
                webtorrent3File('a.jpg', 'folder/a.jpg', 'image/jpeg'),
                webtorrent3File('Thumbnail a.jpg', 'folder/Thumbnail a.jpg', 'image/jpeg'),
                webtorrent3File('b.jpg', 'folder/b.jpg', 'image/jpeg'),
            ],
        });
        await vi.waitFor(() => expect(cachePut).toHaveBeenCalledTimes(2));
        expect(cachePut.mock.calls.map(call => call[0]).sort()).toEqual(['base-folder/a.jpg', 'base-folder/b.jpg']);
    });

    it('caches a single photo under the torrent hash and skips videos', async () => {
        const addition = new TorrentAddition({}, {}, { on: vi.fn() }, {});
        const video = webtorrent3File('v.mp4', 'v.mp4', 'video/mp4');
        await addition.done({ infoHash: 'one', name: 'a.jpg', files: [webtorrent3File('a.jpg', 'a.jpg', 'image/jpeg')] });
        await addition.done({ infoHash: 'two', name: 'v.mp4', files: [video] });
        await vi.waitFor(() => expect(cachePut).toHaveBeenCalledTimes(1));
        expect(cachePut.mock.calls[0][0]).toBe('one');
        expect(video.blob).not.toHaveBeenCalled();
    });
});
