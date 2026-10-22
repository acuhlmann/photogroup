import '../test-setup.js';
import assert from 'assert';
import fs from 'fs';
import os from 'os';
import path from 'path';
import PhotoRelay, { RelayError } from '../../PhotoRelay.js';

describe('PhotoRelay', () => {
    let dir;
    let clock;
    let relays;

    function relay(options = {}) {
        const made = new PhotoRelay({ dir, now: () => clock, ...options });
        relays.push(made);
        return made;
    }

    async function rejects(promise, code) {
        await assert.rejects(promise, err => err instanceof RelayError && err.code === code);
    }

    beforeEach(() => {
        dir = fs.mkdtempSync(path.join(os.tmpdir(), 'relay-unit-'));
        clock = 1000;
        relays = [];
    });

    afterEach(() => {
        relays.forEach(item => item.clear());
        fs.rmSync(dir, { recursive: true, force: true });
    });

    it('wipes copies left by a previous process', () => {
        fs.writeFileSync(path.join(dir, 'stale'), 'old');
        relay();
        assert.deepStrictEqual(fs.readdirSync(dir), []);
    });

    it('stores a file sent in chunks on disk and serves it once complete', async () => {
        const store = relay();
        const first = await store.append('r', 'h1', { offset: 0, size: 6, buffer: Buffer.from('abc'), uploader: 'p1', contentType: 'image/jpeg' });
        assert.strictEqual(first.received, 3);
        assert.strictEqual(store.get('r', 'h1'), null, 'not served while partial');
        assert.strictEqual(store.totalBytes, 6, 'whole file reserved up front');

        const done = await store.append('r', 'h1', { offset: 3, size: 6, buffer: Buffer.from('def'), uploader: 'p1' });
        assert.strictEqual(done.complete, true);
        assert.strictEqual(fs.readFileSync(store.get('r', 'h1').file, 'utf8'), 'abcdef');
        assert.strictEqual(store.get('r', 'h1').contentType, 'image/jpeg');

        await rejects(store.append('r', 'h1', { offset: 0, size: 6, buffer: Buffer.from('x'), uploader: 'p1' }), 'EXISTS');
    });

    it('tells an uploader where to resume after a lost or repeated chunk', async () => {
        const store = relay();
        await store.append('r', 'h1', { offset: 0, size: 6, buffer: Buffer.from('abc'), uploader: 'p1' });
        await assert.rejects(
            store.append('r', 'h1', { offset: 0, size: 6, buffer: Buffer.from('abc'), uploader: 'p1' }),
            err => err.code === 'OFFSET' && err.received === 3);
        await assert.rejects(
            store.append('r', 'h2', { offset: 3, size: 6, buffer: Buffer.from('def'), uploader: 'p1' }),
            err => err.code === 'OFFSET' && err.received === 0);
    });

    it('lets another holder carry on only once the uploader has gone quiet', async () => {
        const store = relay({ leaseMs: 100 });
        await store.append('r', 'h1', { offset: 0, size: 6, buffer: Buffer.from('abc'), uploader: 'sleepy' });
        await rejects(store.append('r', 'h1', { offset: 3, size: 6, buffer: Buffer.from('def'), uploader: 'other' }), 'BUSY');
        clock += 100;
        const done = await store.append('r', 'h1', { offset: 3, size: 6, buffer: Buffer.from('def'), uploader: 'other' });
        assert.strictEqual(done.complete, true);
        assert.strictEqual(fs.readFileSync(done.file, 'utf8'), 'abcdef');
    });

    it('enforces per-file, per-room and total limits', async () => {
        const store = relay({ maxPhotoBytes: 4, maxRoomBytes: 6, maxTotalBytes: 9 });
        await rejects(store.append('r', 'big', { offset: 0, size: 5, buffer: Buffer.from('1'), uploader: 'p' }), 'TOO_LARGE');
        await store.append('r', 'h1', { offset: 0, size: 4, buffer: Buffer.from('1'), uploader: 'p' });
        await rejects(store.append('r', 'h2', { offset: 0, size: 3, buffer: Buffer.from('1'), uploader: 'p' }), 'QUOTA');
        await store.append('r2', 'h1', { offset: 0, size: 4, buffer: Buffer.from('1'), uploader: 'p' });
        await rejects(store.append('r3', 'h1', { offset: 0, size: 2, buffer: Buffer.from('1'), uploader: 'p' }), 'QUOTA');
        store.delete('r', 'h1');
        await store.append('r3', 'h1', { offset: 0, size: 2, buffer: Buffer.from('1'), uploader: 'p' });
    });

    it('rejects bad offsets, sizes and chunks past the end', async () => {
        const store = relay();
        await rejects(store.append('r', 'h', { offset: -1, size: 3, buffer: Buffer.from('a'), uploader: 'p' }), 'INVALID');
        await rejects(store.append('r', 'h', { offset: 0, size: 0, buffer: Buffer.from('a'), uploader: 'p' }), 'INVALID');
        await rejects(store.append('r', 'h', { offset: 0, size: 3, buffer: Buffer.alloc(0), uploader: 'p' }), 'INVALID');
        await rejects(store.append('r', 'h', { offset: 0, size: 2, buffer: Buffer.from('abc'), uploader: 'p' }), 'INVALID');
        await store.append('r', 'h', { offset: 0, size: 3, buffer: Buffer.from('a'), uploader: 'p' });
        await rejects(store.append('r', 'h', { offset: 1, size: 4, buffer: Buffer.from('b'), uploader: 'p' }), 'INVALID');
    });

    it('expires finished copies after the TTL and abandoned uploads sooner', async () => {
        const store = relay({ ttlMs: 1000, staleUploadMs: 300 });
        await store.append('r', 'done', { offset: 0, size: 1, buffer: Buffer.from('a'), uploader: 'p' });
        await store.append('r', 'partial', { offset: 0, size: 2, buffer: Buffer.from('a'), uploader: 'p' });
        const file = store.get('r', 'done').file;

        clock += 300;
        assert.deepStrictEqual(store.sweep().map(entry => entry.infoHash), ['partial']);
        clock += 700;
        assert.deepStrictEqual(store.sweep().map(entry => entry.infoHash), ['done']);
        assert.strictEqual(store.totalBytes, 0);
        await new Promise(resolve => setTimeout(resolve, 20));
        assert.strictEqual(fs.existsSync(file), false);
    });

    it('drops every copy of a room', async () => {
        const store = relay();
        await store.append('r', 'a', { offset: 0, size: 1, buffer: Buffer.from('a'), uploader: 'p' });
        await store.append('r', 'b', { offset: 0, size: 1, buffer: Buffer.from('b'), uploader: 'p' });
        await store.append('other', 'a', { offset: 0, size: 1, buffer: Buffer.from('c'), uploader: 'p' });
        store.deleteRoom('r');
        assert.strictEqual(store.roomBytes('r'), 0);
        assert.ok(store.has('other', 'a'));
    });
});
