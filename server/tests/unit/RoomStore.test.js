import '../test-setup.js';
import assert from 'assert';
import fs from 'fs';
import os from 'os';
import path from 'path';
import RoomStore, { serializablePhoto, ROOM_TTL_MS } from '../../RoomStore.js';

describe('RoomStore', () => {
    let dir;
    let file;
    let clock;

    const room = (id, photos, settings) => ({
        id,
        photos,
        settings: settings || { keepCopies: false },
        createdAt: clock,
        updatedAt: clock,
    });

    function store(options = {}) {
        // A timer that fires at once keeps the tests honest about ordering
        // without waiting on the real debounce.
        return new RoomStore({ file, now: () => clock, debounceMs: 0, setTimer: fn => { fn(); return 0; }, clearTimer: () => {}, ...options });
    }

    beforeEach(() => {
        dir = fs.mkdtempSync(path.join(os.tmpdir(), 'room-store-'));
        file = path.join(dir, 'rooms.json');
        clock = 1_700_000_000_000;
    });

    afterEach(() => { fs.rmSync(dir, { recursive: true, force: true }); });

    it('round-trips a room and its photos', async () => {
        const made = store();
        await made.schedule([room('abc', [{ infoHash: 'h1', fileName: 'beach.jpg', fileType: 'image/jpeg' }])]);
        await made.flush();

        const loaded = store().load();
        assert.strictEqual(loaded.length, 1);
        assert.strictEqual(loaded[0].id, 'abc');
        assert.strictEqual(loaded[0].photos[0].fileName, 'beach.jpg');
    });

    it('restores no owners: a peer id from before the restart means nothing', async () => {
        const made = store();
        await made.schedule([room('abc', [{
            infoHash: 'h1',
            peerId: 'sharer',
            owners: [{ peerId: 'sharer', loading: false }],
        }])]);
        await made.flush();

        const [restored] = store().load();
        assert.strictEqual(restored.photos[0].owners, undefined);
        // The sharer of record stays: it is history, not a live claim.
        assert.strictEqual(restored.photos[0].peerId, 'sharer');
    });

    it('restores no server copy, whose bytes the relay deletes at startup', async () => {
        const made = store();
        await made.schedule([room('abc', [{
            infoHash: 'h1',
            hasServerCopy: true,
            serverCopySize: 500,
            serverCopyReceived: 500,
            serverCopyUploader: 'sharer',
            serverCopyRequestedAt: clock,
        }])]);
        await made.flush();

        const [restored] = store().load();
        const photo = restored.photos[0];
        assert.strictEqual(photo.hasServerCopy, undefined);
        assert.strictEqual(photo.serverCopyRequestedAt, undefined);
        assert.strictEqual(photo.serverCopySize, undefined);
    });

    it('drops a room nobody touched within the ttl', async () => {
        const made = store();
        await made.schedule([room('old', [{ infoHash: 'h1' }])]);
        await made.flush();

        // Same file, read a year later.
        clock = 1_700_000_000_000 + ROOM_TTL_MS + 1000;
        assert.deepStrictEqual(store().load(), []);
    });

    it('lists the busiest room first', async () => {
        const made = store();
        await made.schedule([room('first', [{ infoHash: 'a' }]), room('second', [{ infoHash: 'b' }])]);
        await made.flush();
        const loaded = store().load();
        assert.deepStrictEqual(loaded.map(r => r.id), ['first', 'second']);
    });

    it('starts with no rooms rather than failing on a broken file', () => {
        fs.writeFileSync(file, '{ not json');
        assert.deepStrictEqual(store().load(), []);
    });

    it('starts with no rooms when there is no file yet', () => {
        assert.deepStrictEqual(store().load(), []);
    });

    it('keeps the previous file when a write cannot finish', async () => {
        const made = store();
        await made.schedule([room('abc', [{ infoHash: 'h1' }])]);
        await made.flush();
        const before = fs.readFileSync(file, 'utf8');

        // A path whose parent is a plain file cannot be written or renamed.
        // The timer never fires here: schedule is meant to swallow the failure
        // (a room the server cannot persist is still a room in use), so the
        // rejection is checked on an explicit flush instead.
        let fire;
        const blocked = new RoomStore({
            file: path.join(file, 'nested.json'),
            now: () => clock,
            setTimer: fn => { fire = fn; return 0; },
            clearTimer: () => {},
        });
        blocked.schedule([room('abc', [{ infoHash: 'h2' }])]);
        await assert.rejects(blocked.flush());
        assert.strictEqual(fs.readFileSync(file, 'utf8'), before);

        // The background path logs and moves on rather than throwing.
        blocked.schedule([room('abc', [{ infoHash: 'h3' }])]);
        assert.doesNotThrow(() => fire());
    });

    it('serializes overlapping writes instead of racing them on one file', async () => {
        const made = store();
        // Two flushes at once: each used to rename the same path, so the
        // second found nothing to move. They must queue instead.
        const [first, second] = await Promise.all([
            made.schedule([room('a', [{ infoHash: 'one' }])]),
            made.flush(),
        ]);
        assert.strictEqual(first, second);
        assert.deepStrictEqual(store().load().map(r => r.id), ['a']);
    });

    it('clears the file when every room is dropped', async () => {
        const made = store();
        await made.schedule([room('abc', [{ infoHash: 'h1' }])]);
        await made.flush();
        assert.ok(fs.existsSync(file));
        await made.clear();
        assert.ok(!fs.existsSync(file));
        assert.deepStrictEqual(store().load(), []);
    });

    it('serializablePhoto keeps what a room needs and drops live claims', () => {
        const kept = serializablePhoto({
            infoHash: 'h1', fileName: 'a.jpg', details: { title: 'A' },
            owners: [{ peerId: 'p' }], hasServerCopy: true, serverCopyRequestedAt: 1,
        });
        assert.strictEqual(kept.fileName, 'a.jpg');
        assert.deepStrictEqual(kept.details, { title: 'A' });
        assert.strictEqual(kept.owners, undefined);
        assert.strictEqual(kept.hasServerCopy, undefined);
        assert.strictEqual(kept.serverCopyRequestedAt, undefined);
    });
});
