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
});
