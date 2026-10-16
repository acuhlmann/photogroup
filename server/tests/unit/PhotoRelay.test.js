import '../test-setup.js';
import assert from 'assert';
import PhotoRelay, { PhotoTooLargeError } from '../../PhotoRelay.js';

describe('PhotoRelay', () => {
    it('stores, reads and deletes copies while tracking bytes', () => {
        const relay = new PhotoRelay();
        relay.put('h1', Buffer.from('abc'), 'image/jpeg');
        assert.strictEqual(relay.has('h1'), true);
        assert.strictEqual(relay.get('h1').buffer.toString(), 'abc');
        assert.strictEqual(relay.totalBytes, 3);
        relay.put('h1', Buffer.from('ab'), 'image/jpeg'); // overwrite, no double count
        assert.strictEqual(relay.totalBytes, 2);
        assert.strictEqual(relay.delete('h1'), true);
        assert.strictEqual(relay.totalBytes, 0);
        assert.strictEqual(relay.get('h1'), null);
    });

    it('rejects oversize photos and room-quota overflow', () => {
        const relay = new PhotoRelay({ maxPhotoBytes: 4, maxRoomBytes: 6 });
        assert.throws(() => relay.put('h1', Buffer.from('12345')), PhotoTooLargeError);
        relay.put('h1', Buffer.from('1234'));
        assert.throws(() => relay.put('h2', Buffer.from('123')), PhotoTooLargeError);
    });

    it('rejects empty copies', () => {
        const relay = new PhotoRelay();
        assert.throws(() => relay.put('h1', Buffer.alloc(0)), PhotoTooLargeError);
    });
});
