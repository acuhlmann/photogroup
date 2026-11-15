import { describe, it, expect, vi, beforeEach } from 'vitest';
import EventEmitter from 'eventemitter3';
import NearbyNotes, { HELD_TEXT, serverNotReached } from './nearbyNotes';
import RoomPhotos from '../torrent/RoomPhotos';
import { encodeNotes, peerMark } from './notes';
import { saveDetails } from '../gallery/metadata/saveDetails';
import { saveMyName } from '../header/PeerNameField';

const ROOM = 'z45keexwrxqzbeqimgsz';
const ME = '2d5757303330302d00000000000000000000aaaa';
const ANNA = '2d5757303330302d00000000000000000000bbbb';
const offline = () => new TypeError('Failed to fetch');
const refused = (status) => Object.assign(new Error('no'), { status });

function memory() {
    const items = new Map();
    return {
        getItem: key => (items.has(key) ? items.get(key) : null),
        setItem: (key, value) => items.set(key, String(value)),
        removeItem: key => items.delete(key),
    };
}

function room({ storage = memory() } = {}) {
    const emitter = new EventEmitter();
    const master = {
        emitter,
        client: { peerId: ME },
        me: { name: 'Me' },
        peers: { items: [{ peerId: ME, name: 'Me' }, { peerId: ANNA, name: '' }] },
        roomPhotos: new RoomPhotos(emitter),
        service: {
            id: ROOM,
            hasRoom: true,
            updateDetails: vi.fn(),
            updatePeer: vi.fn(),
        },
    };
    emitter.emit('photos', { type: 'all', item: [
        { infoHash: 'photo-1', fileName: 'one.jpg', details: { title: 'Lake' }, owners: [] },
        { infoHash: 'photo-2', fileName: 'two.jpg', owners: [] },
    ] });
    master.nearbyNotes = new NearbyNotes(master, { storage, now: () => 1000 });
    const seen = { photos: [], peers: [], info: [] };
    emitter.on('photos', event => seen.photos.push(event));
    emitter.on('peers', event => seen.peers.push(event));
    emitter.on('showInfo', text => seen.info.push(text));
    return { master, emitter, storage, seen, notes: master.nearbyNotes };
}

describe('changes with no server', () => {
    beforeEach(() => localStorage.clear());

    it('knows a server that was not reached from a server that said no', () => {
        expect(serverNotReached(offline())).toBe(true);
        expect(serverNotReached(refused(503))).toBe(true);
        expect(serverNotReached(refused(404))).toBe(false);
        expect(serverNotReached(null)).toBe(false);
        // The phone says that it is offline, but an answer came: the answer counts.
        const online = vi.spyOn(navigator, 'onLine', 'get').mockReturnValue(false);
        expect(serverNotReached(refused(404))).toBe(false);
        expect(serverNotReached(null)).toBe(true);
        online.mockRestore();
    });

    it('does not send an older kept change after a newer change that the server took', async () => {
        const { master, notes } = room();
        notes.holdDetails('photo-1', { rating: 2, title: 'Old' }, offline());
        master.service.updateDetails.mockResolvedValueOnce({ infoHash: 'photo-1', details: { rating: 5 } });
        await saveDetails(master, 'photo-1', { rating: 5 });
        // The title was not in the newer change: it waits still.
        expect(notes.waiting('photo-1')).toEqual({ title: 'Old' });
        master.service.updateDetails.mockResolvedValueOnce({ infoHash: 'photo-1', details: { title: 'New' } });
        await saveDetails(master, 'photo-1', { title: 'New' });
        expect(notes.count()).toBe(0);

        notes.holdName('Old name', offline());
        master.service.updatePeer.mockResolvedValueOnce({ peerId: ME, name: 'New name' });
        await saveMyName(master, 'New name');
        expect(notes.count()).toBe(0);
    });

    it('keeps a newer change that came while an older one went to the server', async () => {
        const { master, notes, seen } = room();
        for (const answer of ['taken', 'refused']) {
            notes.holdDetails('photo-1', { rating: 2 }, offline());
            seen.photos.length = 0;
            master.service.updateDetails.mockImplementationOnce(async () => {
                notes.holdDetails('photo-1', { rating: 5 }, offline());
                if (answer === 'refused') throw refused(500);
                return { infoHash: 'photo-1', details: { rating: 2 } };
            });
            await notes.flush();
            expect(notes.waiting('photo-1')).toEqual({ rating: 5 });
            // The screen keeps the newer rating: the older answer is not shown.
            expect(seen.photos).toEqual([]);
            master.service.updateDetails.mockResolvedValueOnce({ infoHash: 'photo-1', details: { rating: 5 } });
            await notes.flush();
            expect(notes.count()).toBe(0);
        }
    });

    it('keeps a star rating, shows it at once and sends it when the server is back', async () => {
        const { master, seen, notes, storage } = room();
        master.service.updateDetails.mockRejectedValueOnce(offline());
        const saved = await saveDetails(master, 'photo-1', { rating: 4 });
        expect(saved).toEqual({ infoHash: 'photo-1', details: { title: 'Lake', rating: 4, editedBy: { peerId: ME, name: 'Me' }, editedAt: 1000 } });
        expect(seen.photos).toEqual([{ type: 'update', item: [saved] }]);
        expect(seen.info).toEqual([HELD_TEXT]);
        expect(notes.count()).toBe(1);
        expect(storage.getItem('photogroup.held.' + ROOM)).toContain('"rating":4');

        // Still no server: the change stays.
        master.service.updateDetails.mockRejectedValueOnce(offline());
        await notes.flush();
        expect(notes.count()).toBe(1);

        master.service.updateDetails.mockResolvedValueOnce({ infoHash: 'photo-1', details: { title: 'Lake', rating: 4 } });
        await notes.flush();
        expect(master.service.updateDetails).toHaveBeenLastCalledWith('photo-1', { rating: 4 });
        expect(notes.count()).toBe(0);
        expect(storage.getItem('photogroup.held.' + ROOM)).toBeNull();
    });

    it('does not keep a change that the server refused', async () => {
        const { master, notes } = room();
        master.service.updateDetails.mockRejectedValueOnce(refused(404));
        await expect(saveDetails(master, 'photo-1', { rating: 4 })).rejects.toThrow('no');
        expect(notes.count()).toBe(0);
    });

    it('drops a kept change when the server refuses it later', async () => {
        const { master, notes } = room();
        notes.holdDetails('photo-1', { rating: 2 }, offline());
        notes.holdDetails('photo-2', { rating: 5 }, offline());
        master.service.updateDetails.mockRejectedValueOnce(refused(404)).mockResolvedValueOnce({ infoHash: 'photo-2', details: { rating: 5 } });
        await notes.flush();
        expect(notes.count()).toBe(0);
    });

    it('keeps a name and sends it later', async () => {
        const { master, notes } = room();
        master.service.updatePeer.mockRejectedValueOnce(offline());
        await expect(saveMyName(master, ' Kalle ')).resolves.toBe('Kalle');
        expect(master.me.name).toBe('Kalle');
        expect(notes.count()).toBe(1);
        master.service.updatePeer.mockResolvedValueOnce({ peerId: ME, name: 'Kalle' });
        await notes.flush();
        expect(master.service.updatePeer).toHaveBeenLastCalledWith({ name: 'Kalle' });
        expect(notes.count()).toBe(0);
    });

    it('still fails a name that the server refused', async () => {
        const { master, notes } = room();
        master.service.updatePeer.mockResolvedValueOnce(undefined);
        await expect(saveMyName(master, 'Kalle')).rejects.toThrow();
        expect(notes.count()).toBe(0);
    });

    it('finds the kept changes again after a reload', () => {
        const storage = memory();
        room({ storage }).notes.holdDetails('photo-1', { rating: 3 }, offline());
        const again = room({ storage });
        expect(again.notes.count()).toBe(1);
        expect(again.notes.myNotes()).toEqual([{ type: 'rating', photo: 'photo-1', rating: 3 }]);
    });

    it('makes notes of the name, the kept ratings and the photos here', () => {
        const { notes, storage } = room();
        storage.setItem('nickname', 'Kalle');
        notes.holdDetails('photo-1', { rating: 3, title: 'Lake at dawn' }, offline());
        notes.holdDetails('photo-2', { title: 'No stars' }, offline());
        expect(notes.myNotes(['photo-2'])).toEqual([
            { type: 'name', name: 'Kalle' },
            { type: 'rating', photo: 'photo-1', rating: 3 },
            { type: 'have', photos: ['photo-2'] },
        ]);
        expect(notes.frames({ have: ['photo-2'] })).toHaveLength(1);
    });

    it('uses a note from a phone nearby: name, rating and photo list', () => {
        const { notes, seen } = room();
        const [frame] = encodeNotes({ room: ROOM, from: peerMark(ANNA), notes: [
            { type: 'name', name: 'Anna' },
            { type: 'rating', photo: 'photo-1', rating: 5 },
            { type: 'rating', photo: 'not-in-this-room', rating: 1 },
            { type: 'have', photos: ['photo-2', 'other'] },
        ] }, 1024);
        expect(notes.apply(frame)).toEqual({ from: peerMark(ANNA), name: 'Anna', names: 1, ratings: 1, have: { count: 2, total: 2 } });
        expect(seen.peers).toEqual([{ type: 'update', item: { peerId: ANNA, name: 'Anna' } }]);
        expect(seen.photos).toEqual([{ type: 'update', item: [{
            infoHash: 'photo-1',
            details: { title: 'Lake', rating: 5, editedBy: { peerId: ANNA, name: 'Anna' }, editedAt: 1000 },
        }] }]);
        expect(notes.whoHas('photo-2')).toEqual(['Anna']);
        expect(notes.whoHas('photo-1')).toEqual([]);
        // The same frame again (sound plays in a loop) changes nothing more.
        expect(notes.apply(frame)).toMatchObject({ ratings: 0 });
    });

    it('does not use its own notes or those of a different room', () => {
        const { notes, seen } = room();
        const note = [{ type: 'rating', photo: 'photo-1', rating: 5 }];
        expect(notes.apply(encodeNotes({ room: ROOM, from: peerMark(ME), notes: note })[0])).toMatchObject({ own: true });
        expect(notes.apply(encodeNotes({ room: 'another-room', from: peerMark(ANNA), notes: note })[0])).toMatchObject({ otherRoom: true });
        expect(notes.apply(new Uint8Array([1, 2, 3]))).toBeNull();
        expect(seen.photos).toEqual([]);
    });
});
