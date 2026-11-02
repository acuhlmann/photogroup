import { describe, it, expect, vi } from 'vitest';
import TorrentMaster, { groupByTorrent, mayDeleteSavedTorrent } from '../TorrentMaster';
import TorrentAddition from '../TorrentAddition';

// Room z45keexwrxqzbeqimgsz (2026-11-02): 8 photos in 5 torrents, three of
// them shared together. Joining added each photo on its own: the first bound
// to the torrent, the other two failed with "Cannot add duplicate torrent".
const ROOM = [
    { infoHash: 'e68e', fileName: '165334.jpg' },
    { infoHash: '548d', fileName: '180804.jpg' },
    { infoHash: 'f09b-pics/170016.jpg', fileName: '170016.jpg' },
    { infoHash: 'f09b-pics/170019.jpg', fileName: '170019.jpg' },
    { infoHash: 'f09b-pics/170023.jpg', fileName: '170023.jpg' },
    { infoHash: '8d19-pics/140859.jpg', fileName: '140859.jpg' },
    { infoHash: '8d19-pics/152412.jpg', fileName: '152412.jpg' },
    { infoHash: 'fc0b', fileName: '165319.jpg' },
];

function joiner(existing = []) {
    const master = Object.create(TorrentMaster.prototype);
    master.creator = { client: { torrents: existing.map(infoHash => ({ infoHash })), get: () => null } };
    master.service = { id: 'room' };
    master.torrentDeletion = { deleteTorrent: vi.fn().mockResolvedValue('x') };
    master.torrentAddition = new TorrentAddition(master.service, {}, { on: vi.fn() }, master);
    master.torrentAddition._add = vi.fn().mockResolvedValue({ infoHash: 'x' });
    return master;
}

describe('joining a room with photos shared together', () => {
    it('adds each torrent once, with all of its photos and their paths', () => {
        const master = joiner();
        master.syncUiWithServerUrls(ROOM, Date.now());

        const calls = master.torrentAddition._add.mock.calls;
        expect(calls.map(call => call[0])).toEqual(['e68e', '548d', 'f09b', '8d19', 'fc0b']);
        const batch = calls.find(call => call[0] === 'f09b');
        expect(batch[1].map(photo => photo.fileName)).toEqual(['170016.jpg', '170019.jpg', '170023.jpg']);
        expect(batch[3]).toEqual(['pics/170016.jpg', 'pics/170019.jpg', 'pics/170023.jpg']);
    });

    it("doesn't add a torrent that is already here", () => {
        const master = joiner(['e68e', 'f09b']);
        master.syncUiWithServerUrls(ROOM, Date.now());
        expect(master.torrentAddition._add.mock.calls.map(call => call[0])).toEqual(['548d', '8d19', 'fc0b']);
    });

    it('groups photos by base infoHash in room order', () => {
        const groups = groupByTorrent(ROOM);
        expect([...groups.keys()]).toEqual(['e68e', '548d', 'f09b', '8d19', 'fc0b']);
        expect(groups.get('8d19')).toHaveLength(2);
        expect(groupByTorrent([{}, null, undefined]).size).toBe(0);
    });
});

describe("opening a room keeps other rooms' saved torrents", () => {
    it('deletes saved metadata only when this room alone used it', () => {
        expect(mayDeleteSavedTorrent({ roomIds: ['room'] }, 'room', ROOM)).toBe(true);
        // Saved in another room: the cause of the sharer losing its torrents.
        expect(mayDeleteSavedTorrent({ roomIds: ['other'] }, 'room', ROOM)).toBe(false);
        expect(mayDeleteSavedTorrent({ roomIds: ['room', 'other'] }, 'room', ROOM)).toBe(false);
        // Saved before rooms were recorded: nobody knows whose it is.
        expect(mayDeleteSavedTorrent({}, 'room', ROOM)).toBe(false);
        // An empty room says nothing about deletions.
        expect(mayDeleteSavedTorrent({ roomIds: ['room'] }, 'room', [])).toBe(false);
        expect(mayDeleteSavedTorrent({ roomIds: ['room'] }, undefined, ROOM)).toBe(false);
    });

    it("leaves another room's torrent alone on resurrect", async () => {
        const master = joiner();
        await expect(master.resurrectTorrent({ infoHash: 'aaaa', name: 'x', roomIds: ['other'] }, ROOM)).resolves.toBe(false);
        expect(master.torrentDeletion.deleteTorrent).not.toHaveBeenCalled();

        await master.resurrectTorrent({ infoHash: 'bbbb', name: 'y', roomIds: ['room'] }, ROOM);
        expect(master.torrentDeletion.deleteTorrent).toHaveBeenCalledOnce();
    });
});

describe('storeTorrent records the room', () => {
    function store(existing) {
        const db = {
            value: existing,
            get: vi.fn((key, cb) => cb(null, db.value)),
            add: vi.fn((key, value, cb) => { db.value = value; cb(); }),
            set: vi.fn((key, value, cb) => { db.value = value; cb(); }),
        };
        const master = { service: { id: 'room' } };
        const addition = new TorrentAddition(master.service, db, { on: vi.fn() }, master);
        return { db, addition };
    }

    // A real torrent file, so parse-torrent accepts it.
    async function torrentFile() {
        const { default: createTorrent } = await import('create-torrent');
        return new Promise((resolve, reject) => createTorrent(new Uint8Array([1, 2, 3]), { name: 'a.jpg' },
            (err, file) => err ? reject(err) : resolve(file)));
    }

    it('saves new metadata with this room', async () => {
        const { db, addition } = store(undefined);
        await addition.storeTorrent({ infoHash: 'h', torrentFile: await torrentFile() });
        expect(db.add).toHaveBeenCalledOnce();
        expect(db.value.roomIds).toEqual(['room']);
    });

    it('adds this room to metadata saved elsewhere', async () => {
        const { db, addition } = store({ infoHash: 'h', roomIds: ['other'] });
        await addition.storeTorrent({ infoHash: 'h', torrentFile: await torrentFile() });
        expect(db.value.roomIds).toEqual(['other', 'room']);
    });

    it('leaves metadata that already names this room', async () => {
        const { db, addition } = store({ infoHash: 'h', roomIds: ['room'] });
        await addition.storeTorrent({ infoHash: 'h', torrentFile: await torrentFile() });
        expect(db.set).not.toHaveBeenCalled();
        expect(db.add).not.toHaveBeenCalled();
    });
});
