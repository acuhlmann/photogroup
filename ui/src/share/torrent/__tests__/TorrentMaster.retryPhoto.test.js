import { describe, it, expect, vi } from 'vitest';
import TorrentMaster from '../TorrentMaster';
import TorrentAddition from '../TorrentAddition';

describe('TorrentMaster.retryPhoto', () => {
    it.each([true, false])('re-adds every matching photo when an existing torrent is %s', async existing => {
        const photos = [
            { infoHash: 'hash-folder/a.jpg' },
            { infoHash: 'other-folder/c.jpg' },
            { infoHash: 'hash-folder/b-c.jpg' }
        ];
        let torrent = existing ? { infoHash: 'hash' } : null;
        const master = Object.create(TorrentMaster.prototype);
        master.creator = { client: {
            get: vi.fn(() => torrent),
            remove: vi.fn((hash, done) => { torrent = null; done(); })
        } };
        master.restartTrackers = vi.fn();
        master.service = { getRoom: vi.fn().mockResolvedValue({ photos }) };
        master.torrentAddition = new TorrentAddition(master.service, {}, { on: vi.fn() }, master);
        master.torrentAddition._add = vi.fn().mockResolvedValue({ infoHash: 'hash' });

        await expect(master.retryPhoto(photos[0])).resolves.toBe(true);

        expect(master.client.remove).toHaveBeenCalledTimes(existing ? 1 : 0);
        if (existing) expect(master.client.remove).toHaveBeenCalledWith('hash', expect.any(Function));
        expect(master.torrentAddition._add).toHaveBeenCalledOnce();
        expect(master.torrentAddition._add).toHaveBeenCalledWith('hash', [photos[0], photos[2]], false, ['folder/a.jpg', 'folder/b-c.jpg']);
    });

    it('uses the base torrent hash when only one compound photo remains', async () => {
        const photo = { infoHash: 'hash-folder/a.jpg' };
        const client = { get: vi.fn().mockReturnValue(null) };
        const service = { getRoom: vi.fn().mockResolvedValue({ photos: [photo] }) };
        const master = { client, service, restartTrackers: vi.fn() };
        master.torrentAddition = new TorrentAddition(service, {}, { on: vi.fn() }, master);
        master.torrentAddition._add = vi.fn().mockResolvedValue({ infoHash: 'hash' });

        await expect(TorrentMaster.prototype.retryPhoto.call(master, photo)).resolves.toBe(true);
        expect(master.torrentAddition._add).toHaveBeenCalledWith('hash', [photo], undefined);
    });

    it('ignores a photo without an infoHash', async () => {
        await expect(TorrentMaster.prototype.retryPhoto.call({}, {})).resolves.toBe(false);
    });
});
