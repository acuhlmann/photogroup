import { describe, it, expect, vi } from 'vitest';
import EventEmitter from 'eventemitter3';
import TorrentAddition from '../TorrentAddition';
import RoomsService from '../../RoomsService';

vi.mock('../../util/ImageBlobCache', () => ({ cachePut: vi.fn().mockResolvedValue() }));

describe('server copy uploads', () => {
    it('keeps each blob paired with its shared compound hash while torrent storage changes photos', async () => {
        const emitter = new EventEmitter();
        const files = ['a.mp4', 'b.mp4'].map(name => new File([name], name, { type: 'video/mp4' }));
        const torrent = Object.assign(new EventEmitter(), {
            infoHash: 'basehash', magnetURI: 'magnet:test',
            files: files.slice().reverse().map(file => ({ name: file.name, path: 'folder/' + file.name }))
        });
        let finishShare;
        const service = {
            share: vi.fn(photos => {
                // RoomsService.share encodes its input before sending it.
                photos.forEach(photo => { photo.infoHash = encodeURIComponent(photo.infoHash); });
                return new Promise(resolve => { finishShare = resolve; });
            }),
            uploadServerCopy: vi.fn().mockResolvedValue({})
        };
        const master = {
            client: { peerId: 'owner' }, emitter,
            addSeedOrGetTorrent: vi.fn((action, input, ready) => { ready(torrent); return torrent; })
        };
        const addition = new TorrentAddition(service, {}, emitter, master);
        addition.storeTorrent = vi.fn().mockResolvedValue(torrent);
        let photos;
        emitter.on('photos', event => { if (event.type === 'add') photos = event.item; });

        await addition.seed(files);
        // Storage follows torrent order, which differs from the original photo order.
        expect(photos[0].infoHash).toBe('basehash-folder/b.mp4');
        expect(service.uploadServerCopy).not.toHaveBeenCalled();
        finishShare([]);

        await vi.waitFor(() => expect(service.uploadServerCopy).toHaveBeenCalledTimes(2));
        expect(service.uploadServerCopy).toHaveBeenNthCalledWith(1, 'basehash-folder/a.mp4', files[0]);
        expect(service.uploadServerCopy).toHaveBeenNthCalledWith(2, 'basehash-folder/b.mp4', files[1]);
    });

    it('sends the current uploader identity along with the encoded photo hash', async () => {
        const fetchMock = vi.spyOn(globalThis, 'fetch').mockResolvedValue({ ok: true, json: async () => ({}) });
        try {
            const service = { url: '/api/rooms', id: 'room', master: { client: { peerId: 'owner+1' } } };
            const blob = new Blob(['jpg'], { type: 'image/jpeg' });
            await RoomsService.prototype.uploadServerCopy.call(service, 'hash-folder/a.jpg', blob);
            expect(fetchMock).toHaveBeenCalledWith('/api/rooms/room/photos/blob?infoHash=hash-folder%2Fa.jpg&peerId=owner%2B1', {
                method: 'POST', headers: { 'Content-Type': 'image/jpeg' }, body: blob
            });
        } finally {
            fetchMock.mockRestore();
        }
    });
});
