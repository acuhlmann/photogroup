import { describe, it, expect, vi, beforeEach } from 'vitest';
import { EventEmitter } from 'events';
import TorrentAddition from '../TorrentAddition';
import { clearHave, rememberHave } from '../../gallery/alreadyHave';

const HAVE = '3:' + 'a'.repeat(64);
const NEW = '3:' + 'b'.repeat(64);

const file = (name, path) => ({ name, path, done: false, progress: 0, select: vi.fn(), deselect: vi.fn() });

/** A two-photo torrent, each photo with its "Thumbnail" file. */
function fakeTorrent() {
    const torrent = new EventEmitter();
    torrent.infoHash = 'base';
    torrent.name = 'folder';
    torrent.magnetURI = 'magnet:?xt=urn:btih:base';
    torrent.files = [
        file('a.jpg', 'folder/a.jpg'), file('Thumbnail a.jpg', 'folder/Thumbnail a.jpg'),
        file('b.jpg', 'folder/b.jpg'), file('Thumbnail b.jpg', 'folder/Thumbnail b.jpg'),
    ];
    return torrent;
}

function setup() {
    const torrent = fakeTorrent();
    const master = {
        client: { peerId: 'me' },
        service: { addOwner: vi.fn().mockResolvedValue([]) },
        serverFallback: { watch: vi.fn(), unwatch: vi.fn() },
        addSeedOrGetTorrent: vi.fn(() => torrent),
    };
    const emitter = { on: vi.fn(), emit: vi.fn() };
    const addition = new TorrentAddition(master.service, {}, emitter, master);
    addition.defineStrategy = vi.fn();
    addition.storeTorrent = vi.fn(async t => t);
    const photos = [
        { infoHash: 'base-folder/a.jpg', fileName: 'a.jpg', fingerprint: HAVE },
        { infoHash: 'base-folder/b.jpg', fileName: 'b.jpg', fingerprint: NEW },
    ];
    const added = addition._add('base', photos, false, ['folder/a.jpg', 'folder/b.jpg']);
    torrent.emit('metadata');
    return { torrent, master, emitter, addition, photos, added };
}

describe("photos you have don't download again", () => {
    beforeEach(() => clearHave());

    it('fetches only the preview of a photo you have, and all of a new one', async () => {
        rememberHave(HAVE, 'saved');
        const { torrent, master, photos, added } = setup();
        await added;

        expect(master.addSeedOrGetTorrent.mock.calls[0][3]).toEqual({ deselect: true });
        const [have, fresh] = photos;
        expect(have.previewOnly).toBe(true);
        expect(torrent.files[1].select).toHaveBeenCalled();
        expect(torrent.files[0].select).not.toHaveBeenCalled();
        expect(fresh.previewOnly).toBeUndefined();
        expect(torrent.files[2].select).toHaveBeenCalled();

        // No server copy for the photo you have, and you aren't waiting for it.
        expect(master.serverFallback.watch.mock.calls.map(call => call[0].fileName)).toEqual(['b.jpg']);
        expect(master.service.addOwner.mock.calls[0][0].map(owner => owner.infoHash)).toEqual(['base-folder/b.jpg']);

        // Download anyway.
        have.loadFull();
        expect(have.previewOnly).toBe(false);
        expect(torrent.files[0].select).toHaveBeenCalled();
        expect(master.serverFallback.watch).toHaveBeenCalledTimes(2);
    });

    it('brings back a photo you shared in full, so a refresh keeps your own photos', async () => {
        rememberHave(HAVE, 'shared');
        const { master, photos, added } = setup();
        await added;

        expect(master.addSeedOrGetTorrent.mock.calls[0][3]).toBeUndefined();
        expect(photos.every(photo => !photo.previewOnly)).toBe(true);
    });

    it('selects everything as before when you have none of them', async () => {
        const { master, photos, added } = setup();
        await added;

        expect(master.addSeedOrGetTorrent.mock.calls[0][3]).toBeUndefined();
        expect(photos.every(photo => !photo.previewOnly)).toBe(true);
        expect(master.serverFallback.watch).toHaveBeenCalledTimes(2);
    });

    it('stops a photo still arriving once a folder check finds it', async () => {
        const { torrent, master, emitter, photos, added } = setup();
        await added;

        rememberHave(HAVE, 'device');

        const [found, other] = photos;
        expect(found.previewOnly).toBe(true);
        expect(torrent.files[0].deselect).toHaveBeenCalled();
        expect(torrent.files[1].select).toHaveBeenCalled();
        expect(master.serverFallback.unwatch).toHaveBeenCalledWith('base-folder/a.jpg');
        expect(emitter.emit).toHaveBeenCalledWith('photos', { type: 'update', item: [found] });
        expect(other.previewOnly).toBeUndefined();
        expect(torrent.files[2].deselect).not.toHaveBeenCalled();
    });
});
