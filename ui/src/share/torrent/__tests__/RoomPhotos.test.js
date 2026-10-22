import { describe, it, expect } from 'vitest';
import EventEmitter from 'eventemitter3';
import RoomPhotos, { holds } from '../RoomPhotos';

describe('RoomPhotos', () => {
    function setup() {
        const emitter = new EventEmitter();
        const photos = new RoomPhotos(emitter);
        const emit = event => emitter.emit('photos', event);
        return { photos, emit };
    }

    it('follows owners and server-copy state from room events', () => {
        const { photos, emit } = setup();
        emit({ type: 'all', item: [{ infoHash: 'a', peerId: 'sam', fileName: 'a.jpg', owners: [{ peerId: 'sam', loading: false }] }] });
        emit({ type: 'add', item: [{ infoHash: 'b', peerId: 'kim', owners: [] }] });
        emit({ type: 'addOwner', item: [{ infoHash: 'a', peerId: 'me', loading: true }] });
        emit({ type: 'updateOwner', item: [{ infoHash: 'a', peerId: 'me', loading: false, progress: 100 }] });
        emit({ type: 'update', item: [{ infoHash: 'a', serverCopyRequestedAt: 5 }] });

        const a = photos.get('a');
        expect(a.owners).toEqual([{ peerId: 'sam', loading: false }, { infoHash: 'a', peerId: 'me', loading: false, progress: 100 }]);
        expect(a.serverCopyRequestedAt).toBe(5);
        expect(holds(a, 'me')).toBe(true);
        expect(holds(photos.get('b'), 'kim')).toBe(true); // the sharer
        expect(holds(photos.get('b'), 'me')).toBe(false);

        emit({ type: 'removeOwner', item: 'me' });
        expect(holds(photos.get('a'), 'me')).toBe(false);
        emit({ type: 'delete', item: 'b' });
        expect(photos.get('b')).toBeNull();
    });

    it('keeps news a late snapshot predates', () => {
        const { photos, emit } = setup();
        emit({ type: 'all', item: [{ infoHash: 'a', peerId: 'sam', owners: [] }] });
        emit({ type: 'update', item: [{ infoHash: 'a', hasServerCopy: true, serverCopySize: 3 }] });
        emit({ type: 'all', item: [{ infoHash: 'a', peerId: 'sam', owners: [] }, { infoHash: 'b', peerId: 'kim' }] });
        expect(photos.get('a').hasServerCopy).toBe(true);
        // A snapshot saying the copy went wins.
        emit({ type: 'all', item: [{ infoHash: 'a', peerId: 'sam', hasServerCopy: false, owners: [] }] });
        expect(photos.get('a').hasServerCopy).toBe(false);
        expect(photos.get('b')).toBeNull();
    });

    it("keeps only the server's fields from local tile updates, and ignores placeholders", () => {
        const { photos, emit } = setup();
        emit({ type: 'add', item: [{ infoHash: 'tmp1', isFake: true, peerId: 'me' }] });
        expect(photos.get('tmp1')).toBeNull();

        // Our own share, confirmed: only the sharer hears it as an update.
        const file = new File(['x'], 'x.jpg');
        emit({ type: 'update', item: [{ infoHash: 'c', peerId: 'me', url: 'magnet:?', fileName: 'x.jpg', file, owners: [{ peerId: 'stale' }] }] });
        expect(photos.get('c')).toEqual({ infoHash: 'c', peerId: 'me', fileName: 'x.jpg', owners: [] });

        emit({ type: 'update', item: [{ infoHash: 'c', img: 'blob:x', hasServerCopy: true }] });
        expect(photos.get('c').img).toBeUndefined();
        expect(photos.get('c').hasServerCopy).toBe(true);

        emit({ type: 'update', item: [{ infoHash: 'unknown', hasServerCopy: true }] });
        expect(photos.get('unknown')).toBeNull();
    });
});
