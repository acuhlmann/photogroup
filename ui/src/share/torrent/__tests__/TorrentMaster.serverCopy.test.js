import { describe, it, expect, vi } from 'vitest';
import TorrentMaster from '../TorrentMaster';
import RoomPhotos from '../RoomPhotos';

vi.mock('../../util/ImageBlobCache', () => ({
    cacheGet: vi.fn(async infoHash => (infoHash === 'cached' || infoHash === 'secret') ? new Blob(['cached']) : null),
    cachePut: vi.fn(),
    shouldCacheBlob: () => true,
}));

function fakeMaster({ torrents = {}, photos = [], peers = [] } = {}) {
    const master = Object.create(TorrentMaster.prototype);
    master.roomPhotos = new RoomPhotos();
    master.roomPhotos.apply({ type: 'all', item: photos });
    master.peers = { items: peers };
    master.creator = { client: { peerId: 'me', torrents: Object.entries(torrents).map(([infoHash, torrent]) => ({ infoHash, ...torrent })) } };
    master._serverCopies = new Map();
    master.service = { addOwner: vi.fn().mockResolvedValue({}), updateOwner: vi.fn().mockResolvedValue({}) };
    return master;
}

describe('TorrentMaster and server copies', () => {
    it('tells a stalled download whether anyone who has the photo is in front', () => {
        const master = fakeMaster({
            photos: [{ infoHash: 'a', peerId: 'sam', hasServerCopy: true, owners: [{ peerId: 'sam', loading: false }, { peerId: 'kim', loading: false }] }],
            peers: [{ peerId: 'me' }, { peerId: 'sam', away: 1 }, { peerId: 'kim' }],
        });
        expect(master.copyState('a')).toEqual({ hasServerCopy: true, holders: 2, activeHolders: 1 });
        master.peers.items[2].away = 2;
        expect(master.copyState('a').activeHolders).toBe(0);
        expect(master.copyState('unknown')).toEqual({});
    });

    it('finds the bytes the torrent carries, by path for multi-file torrents', async () => {
        const file = (path, text) => ({ path, name: path.split('/').pop(), blob: async () => new Blob([text]) });
        const master = fakeMaster({ torrents: {
            multi: { done: true, files: [file('f/Thumbnail a.jpg', 'thumb'), file('f/a.jpg', 'A'), file('f/b.jpg', 'B')] },
            single: { done: true, files: [file('Thumbnail c.jpg', 'thumb'), file('c.jpg', 'C')] },
            loading: { done: false, files: [file('d.jpg', 'D')] },
        } });
        expect(await (await master.findPhotoBytes('multi-f/b.jpg')).text()).toBe('B');
        expect(await (await master.findPhotoBytes('single')).text()).toBe('C');
        expect(await master.findPhotoBytes('loading')).toBeNull();
        expect(await (await master.findPhotoBytes('cached')).text()).toBe('cached');
    });

    it("never offers an encrypted share's decrypted cache", async () => {
        const master = fakeMaster({ photos: [{ infoHash: 'secret', peerId: 'me', secure: true, owners: [] }] });
        expect(await master.findPhotoBytes('secret')).toBeNull();
    });

    it('counts a photo received from the server as had, and can pass it on', async () => {
        const master = fakeMaster();
        const file = new File(['x'], 'x.jpg');
        master.handleServerCopyReady({ infoHash: 'a', file });
        await vi.waitFor(() => expect(master.service.updateOwner).toHaveBeenCalled());
        expect(master.service.addOwner).toHaveBeenCalledWith([{ infoHash: 'a', peerId: 'me', loading: false }]);
        expect(master.service.updateOwner).toHaveBeenCalledWith([{ infoHash: 'a', peerId: 'me', loading: false }]);
        expect(await master.findPhotoBytes('a')).toBe(file);
    });
});
