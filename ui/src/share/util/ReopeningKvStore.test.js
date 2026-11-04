import { describe, it, expect, vi } from 'vitest';
import { EventEmitter } from 'events';
import ReopeningKvStore from './ReopeningKvStore';
import TorrentMaster from '../torrent/TorrentMaster';

/** Acts like an IdbKvStore: once closed, every call throws, as Safari left it. */
class FakeStore extends EventEmitter {
    constructor(records = []) {
        super();
        this._closed = false;
        this.records = records;
    }
    _check() { if (this._closed) throw new Error('Database is closed'); }
    get(key, cb) { this._check(); cb(null, this.records.find(r => r.infoHash === key)); }
    iterator(next) {
        this._check();
        const rest = [...this.records];
        const step = () => {
            const value = rest.shift();
            next(null, value ? { value, continue: step } : null);
        };
        step();
    }
    browserCloses() {
        this._closed = true;
        this.emit('close');
        this.removeAllListeners();
    }
}

describe('ReopeningKvStore', () => {
    it('opens the database again on the next call after the browser closed it', () => {
        const stores = [];
        const open = vi.fn(() => { const s = new FakeStore([{ infoHash: 'abc' }]); stores.push(s); return s; });
        const db = new ReopeningKvStore('torrents', { open });
        const closed = vi.fn();
        db.on('close', closed);

        stores[0].browserCloses();
        expect(closed).toHaveBeenCalled();

        const cb = vi.fn();
        db.get('abc', cb);
        expect(open).toHaveBeenCalledTimes(2);
        expect(cb).toHaveBeenCalledWith(null, { infoHash: 'abc' });
    });

    it('does not throw on a store error when nobody listens', () => {
        const stores = [];
        const db = new ReopeningKvStore('image-blob-cache', { open: () => { const s = new FakeStore(); stores.push(s); return s; } });
        expect(() => stores[0].emit('error', new Error('UnknownError'))).not.toThrow();
        expect(db.opens).toBe(1);
    });
});

describe('opening a room when the saved torrents cannot be read', () => {
    it('still shows the room photos and goes on to add them', async () => {
        const master = Object.create(TorrentMaster.prototype);
        const dead = new FakeStore();
        dead.browserCloses();
        master.torrentsDb = dead; // the old IdbKvStore, which threw "Database is closed"
        master.peers = {};
        master.emitter = new EventEmitter();
        master.serveCachedPhotos = vi.fn(async () => {});
        master.syncUiWithServerUrls = vi.fn();
        master.fillMissingOwners = vi.fn();
        const photos = [{ infoHash: 'abc' }];
        const onPhotos = vi.fn();
        master.emitter.on('photos', onPhotos);

        await master.findExistingContent(() => Promise.resolve({ peers: [], connections: [], photos }));

        expect(onPhotos).toHaveBeenCalledWith(expect.objectContaining({ type: 'all', item: photos }));
        expect(master.syncUiWithServerUrls).toHaveBeenCalledWith(photos, expect.any(Number));
        expect(master.fillMissingOwners).toHaveBeenCalledWith(photos);
    });
});
