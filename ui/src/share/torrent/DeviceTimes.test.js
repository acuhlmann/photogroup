import { describe, it, expect } from 'vitest';
import EventEmitter from 'eventemitter3';
import DeviceTimes from './DeviceTimes';

describe('DeviceTimes', () => {
    it('times each device from when it could start to its first photo and to all of them', async () => {
        let now = 1000;
        let peers = [{ peerId: 'me' }];
        let photos = [];
        const emitter = new EventEmitter();
        const times = new DeviceTimes({ emitter, getPeers: () => peers, getPhotos: () => photos, getMyPeerId: () => 'me', now: () => now });
        const tick = async (at, change) => {
            now = at;
            change();
            emitter.emit('photos', {});
            await Promise.resolve();
        };
        await tick(1000, () => {});
        await tick(2000, () => { photos = [{ infoHash: 'a', peerId: 'me', owners: [{ peerId: 'me' }] }, { infoHash: 'b', peerId: 'me', owners: [{ peerId: 'me' }] }]; });
        await tick(5000, () => { peers = [...peers, { peerId: 'ana' }]; });
        await tick(7000, () => { photos[0].owners.push({ peerId: 'ana' }); });
        let ana = times.read().find(row => row.peerId === 'ana');
        expect(ana).toMatchObject({ wanted: 2, got: 1, firstMs: 2000, allMs: null, waitingMs: 2000 });
        expect(times.summary().done).toBe(false);

        await tick(12000, () => { photos[1].owners.push({ peerId: 'ana', loading: true }); });
        await tick(15000, () => { photos[1].owners[1].loading = false; });
        ana = times.read().find(row => row.peerId === 'ana');
        expect(ana).toMatchObject({ got: 2, firstMs: 2000, allMs: 10000 });
        // From the first photo appearing to the last one landing.
        expect(times.summary()).toMatchObject({ done: true, devices: 2, photos: 2, totalMs: 13000 });
    });

    it('gives no time for photos a device already had when this one looked', async () => {
        const emitter = new EventEmitter();
        const photos = [{ infoHash: 'a', peerId: 'bo', owners: [{ peerId: 'bo' }, { peerId: 'ana' }] }];
        const times = new DeviceTimes({ emitter, getPeers: () => [{ peerId: 'me' }, { peerId: 'ana' }, { peerId: 'bo' }], getPhotos: () => photos, getMyPeerId: () => 'me' });
        times.sample();
        expect(times.read().find(row => row.peerId === 'ana')).toMatchObject({ got: 1, firstMs: null, before: true });
    });
});
