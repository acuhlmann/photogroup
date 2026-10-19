import { describe, it, expect, vi } from 'vitest';
import GalleryPhotoHandler from '../GalleryPhotoHandler';

describe('GalleryPhotoHandler', () => {
    describe('sortPictures', () => {
        it('should sort photos by date descending', () => {
            const handler = new GalleryPhotoHandler({}, {});
            const photos = [
                { picDateTaken: '10:0 Jan 1 2024' },
                { picDateTaken: '10:0 Jun 15 2024' },
                { picDateTaken: '10:0 Mar 1 2024' },
            ];
            handler.sortPictures(photos, 'H:m MMM d y');
            expect(photos[0].picDateTaken).toBe('10:0 Jun 15 2024');
            expect(photos[2].picDateTaken).toBe('10:0 Jan 1 2024');
        });
    });

    describe('sync - add event with date formatting', () => {
        it('should format picDateTaken without TypeError when date-fns format is not shadowed', () => {
            let capturedTiles;
            const mockView = {
                setTiles: vi.fn((callback) => {
                    capturedTiles = callback([]);
                }),
            };

            const handlers = {};
            const mockEmitter = {
                on: vi.fn((event, handler) => { handlers[event] = handler; }),
                emit: vi.fn(),
            };

            const handler = new GalleryPhotoHandler(mockView, mockEmitter);
            handler.sync();

            const testDate = new Date(2024, 5, 15, 14, 30).getTime();
            handlers['photos']({
                type: 'add',
                item: [{
                    infoHash: 'test123',
                    owners: [],
                    file: { lastModified: testDate },
                }],
            });

            expect(mockView.setTiles).toHaveBeenCalled();
            expect(capturedTiles).toBeDefined();
            expect(capturedTiles.length).toBe(1);
            expect(capturedTiles[0].picDateTaken).toBeDefined();
            expect(typeof capturedTiles[0].picDateTaken).toBe('string');
        });
    });

    describe('sync - batches', () => {
        function setup(initial = []) {
            let tiles = initial;
            const view = { setTiles: fn => { tiles = fn(tiles); } };
            const handlers = {};
            const emitter = { on: (event, h) => { handlers[event] = h; }, emit: vi.fn() };
            new GalleryPhotoHandler(view, emitter).sync();
            return { emit: event => handlers.photos(event), tiles: () => tiles };
        }
        const photo = (infoHash, extra = {}) => ({ infoHash, owners: [], picDateTaken: '10:0 Jan 1 2024', ...extra });

        it('adds every photo of a multi-file upload', () => {
            const g = setup();
            g.emit({ type: 'add', item: [photo('a'), photo('b'), photo('c')] });
            expect(g.tiles().map(t => t.infoHash).sort()).toEqual(['a', 'b', 'c']);
        });

        it('applies every update in a batch', () => {
            const g = setup();
            g.emit({ type: 'add', item: [photo('a'), photo('b')] });
            g.emit({ type: 'update', item: [{ infoHash: 'a', loading: false }, { infoHash: 'b', loading: false }] });
            expect(g.tiles().map(t => t.loading)).toEqual([false, false]);
        });

        it('adds owners to every photo in a batch', () => {
            const g = setup();
            g.emit({ type: 'add', item: [photo('a'), photo('b')] });
            g.emit({ type: 'addOwner', item: [{ infoHash: 'a', peerId: 'p' }, { infoHash: 'b', peerId: 'p' }] });
            expect(g.tiles().map(t => t.owners.length)).toEqual([1, 1]);
        });

        it('removes an owner from every photo', () => {
            const g = setup([photo('a', { owners: [{ peerId: 'p' }] }), photo('b', { owners: [{ peerId: 'p' }] })]);
            g.emit({ type: 'removeOwner', item: 'p' });
            expect(g.tiles().map(t => t.owners.length)).toEqual([0, 0]);
        });

        it('keeps the tile key while the infoHash changes during seeding', () => {
            const g = setup();
            const seeded = photo('temp-id');
            g.emit({ type: 'add', item: [seeded] });
            seeded.infoHash = 'torrenthash-big0.jpg';
            g.emit({ type: 'update', item: [{ infoHash: 'torrenthash-big0.jpg', loading: false }] });
            g.emit({ type: 'all', item: [photo('torrenthash-big0.jpg')] });
            expect(g.tiles()[0].tileKey).toBe('temp-id');
        });

        it('keeps what this browser loaded when the room re-syncs', () => {
            const g = setup();
            g.emit({ type: 'add', item: [photo('a')] });
            g.emit({ type: 'update', item: [{ infoHash: 'a', loading: false, img: 'blob:a', metadata: { Make: 'Google' } }] });
            g.emit({ type: 'all', item: [photo('a')] });
            expect(g.tiles()[0]).toMatchObject({ loading: false, img: 'blob:a', metadata: { Make: 'Google' } });
        });

        it('keeps an upload the room snapshot does not know about yet', () => {
            const g = setup();
            g.emit({ type: 'add', item: [photo('mine', { seed: true })] });
            g.emit({ type: 'all', item: [photo('theirs')], requestedAt: 1000 });
            expect(g.tiles().map(t => t.infoHash).sort()).toEqual(['mine', 'theirs']);
        });

        it('drops a confirmed upload the server no longer lists', () => {
            const g = setup();
            g.emit({ type: 'add', item: [photo('mine', { seed: true, sharedAt: 500 })] });
            g.emit({ type: 'all', item: [], requestedAt: 1000 });
            expect(g.tiles()).toEqual([]);
        });

        it('applies an update by tile key after the upload got its infoHash', () => {
            const g = setup();
            const seeded = photo('temp-id', { seed: true });
            g.emit({ type: 'add', item: [seeded] });
            g.emit({ type: 'update', item: [{ ...seeded, thumbnailFiles: [] }] });
            seeded.infoHash = 'torrenthash';
            g.emit({ type: 'update', item: [{ ...seeded, loading: false }] });
            expect(g.tiles()).toHaveLength(1);
            expect(g.tiles()[0]).toMatchObject({ infoHash: 'torrenthash', loading: false });
        });
    });
});
