import { describe, it, expect, vi } from 'vitest';
import EventEmitter from 'eventemitter3';
import TorrentMaster, { keptPhoto } from '../TorrentMaster';

function fakeMaster(kept, { hasRoom = true } = {}) {
    const master = Object.create(TorrentMaster.prototype);
    master.emitter = new EventEmitter();
    master.service = { id: 'room1', hasRoom };
    master.offlineRoom = { load: vi.fn().mockResolvedValue(), descriptions: () => kept };
    master.serveCachedPhotos = vi.fn().mockResolvedValue();
    master.loadSteps = { log: vi.fn() };
    return master;
}

describe('TorrentMaster.showKeptRoom', () => {
    it('shows the room as this device kept it, marked kept', async () => {
        const master = fakeMaster([{ infoHash: 'a', fileName: 'a.jpg', poster: 'data:image/jpeg;base64,x' }]);
        const events = [];
        master.emitter.on('photos', event => events.push(event));
        expect(await master.showKeptRoom()).toBe(true);
        expect(events).toHaveLength(1);
        expect(events[0]).toMatchObject({ type: 'all', kept: true });
        expect(events[0].item[0]).toMatchObject({ infoHash: 'a', poster: 'data:image/jpeg;base64,x', owners: [] });
        expect(master.serveCachedPhotos).toHaveBeenCalledWith(events[0].item);
    });

    it('does it once, and not after the server list is here', async () => {
        const master = fakeMaster([{ infoHash: 'a' }]);
        const handle = vi.fn();
        master.emitter.on('photos', handle);
        await master.showKeptRoom();
        await master.showKeptRoom();
        expect(handle).toHaveBeenCalledTimes(1);

        const late = fakeMaster([{ infoHash: 'a' }]);
        late.roomSynced = true;
        expect(await late.showKeptRoom()).toBe(false);
    });

    it('stays quiet when the server list comes while the kept copy is read', async () => {
        const master = fakeMaster([{ infoHash: 'a' }]);
        master.offlineRoom.load = vi.fn(async () => { master.roomSynced = true; });
        const handle = vi.fn();
        master.emitter.on('photos', handle);
        expect(await master.showKeptRoom()).toBe(false);
        expect(handle).not.toHaveBeenCalled();
    });

    it('shows nothing for an empty copy or with no room: only the server can say a room is empty', async () => {
        const handle = vi.fn();
        const empty = fakeMaster([]);
        empty.emitter.on('photos', handle);
        expect(await empty.showKeptRoom()).toBe(false);
        const front = fakeMaster([{ infoHash: 'a' }], { hasRoom: false });
        front.emitter.on('photos', handle);
        expect(await front.showKeptRoom()).toBe(false);
        expect(handle).not.toHaveBeenCalled();
    });
});

describe('keptPhoto', () => {
    it('leaves out who has the photo and its server copy', () => {
        const photo = { infoHash: 'a', owners: [{ peerId: 'p' }], hasServerCopy: true, serverCopyRequestedAt: 1, serverCopySize: 5, details: { title: 'Sea' } };
        expect(keptPhoto(photo)).toEqual({ infoHash: 'a', owners: [], details: { title: 'Sea' } });
        expect(photo.owners).toHaveLength(1);
    });
});
