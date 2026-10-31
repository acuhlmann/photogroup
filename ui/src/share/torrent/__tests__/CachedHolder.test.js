import { describe, expect, it, vi } from 'vitest';
import TorrentMaster from '../TorrentMaster';
import TorrentAddition from '../TorrentAddition';

// A refresh where a photo is whole in this browser's cache but has no
// torrent here to seed it: the device must still count as having it, and
// must not ask the room for a server copy of its own photo.
describe('a photo kept only in the cache', () => {
    function master(torrents = []) {
        const m = Object.create(TorrentMaster.prototype);
        m.creator = { client: { peerId: 'me', torrents } };
        return m;
    }
    const cachedFile = new Blob(['jpg'], { type: 'image/jpeg' });

    it('says this device has it when its torrent has no files', () => {
        const m = master([{ infoHash: 'abc', files: [], done: false }]);
        expect(m.fillMissingOwnersItem({ infoHash: 'abc', owners: [], cachedFile }))
            .toEqual({ infoHash: 'abc', peerId: 'me', loading: false });
    });

    it('prefers the cache over an unfinished torrent', () => {
        const m = master([{ infoHash: 'abc', files: [{ name: 'a.jpg' }], done: false }]);
        expect(m.fillMissingOwnersItem({ infoHash: 'abc', owners: [], cachedFile }))
            .toEqual({ infoHash: 'abc', peerId: 'me', loading: false });
    });

    it('says it is no longer loading when it was listed as loading', () => {
        const m = master([{ infoHash: 'abc', files: [{ name: 'a.jpg' }], done: false }]);
        m.service = { updateOwner: vi.fn() };
        const owner = { peerId: 'me', loading: true };
        expect(m.fillMissingOwnersItem({ infoHash: 'abc', owners: [owner], cachedFile })).toBeNull();
        expect(owner.loading).toBe(false);
        expect(m.service.updateOwner).toHaveBeenCalledWith([{ infoHash: 'abc', peerId: 'me', loading: false }]);
    });

    it('says so with no torrent at all', () => {
        expect(master().fillMissingOwnersItem({ infoHash: 'abc', owners: [], cachedFile }))
            .toEqual({ infoHash: 'abc', peerId: 'me', loading: false });
    });

    it('does not claim a private photo, a preview, or one already listed', () => {
        const m = master();
        expect(m.fillMissingOwnersItem({ infoHash: 'abc', owners: [], cachedFile, secure: true })).toBeNull();
        expect(m.fillMissingOwnersItem({ infoHash: 'abc', owners: [], cachedFile, previewOnly: true })).toBeNull();
        expect(m.fillMissingOwnersItem({ infoHash: 'abc', owners: [{ peerId: 'me' }], cachedFile })).toBeNull();
        expect(m.fillMissingOwnersItem({ infoHash: 'abc', owners: [] })).toBeNull();
    });

    it('finds the torrent of a photo shared with others in one go', () => {
        const m = master([{ infoHash: 'abc', files: [{ name: 'a.jpg' }], done: true }]);
        expect(m.fillMissingOwnersItem({ infoHash: 'abc-dir/a.jpg', owners: [] }))
            .toEqual({ infoHash: 'abc-dir/a.jpg', peerId: 'me', loading: false });
    });

    it('does not ask for a server copy of a photo it already has', () => {
        const watch = vi.fn();
        const addition = Object.create(TorrentAddition.prototype);
        addition.master = { serverFallback: { watch } };
        addition.watchFallback({ infoHash: 'abc', cachedFile }, {});
        expect(watch).not.toHaveBeenCalled();
        addition.watchFallback({ infoHash: 'def' }, {});
        expect(watch).toHaveBeenCalledOnce();
    });
});
