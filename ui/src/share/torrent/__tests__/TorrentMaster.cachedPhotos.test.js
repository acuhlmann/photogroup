import { afterEach, describe, expect, it, vi } from 'vitest';
import EventEmitter from 'eventemitter3';
import TorrentMaster from '../TorrentMaster';
import { cacheGet } from '../../util/ImageBlobCache';

vi.mock('../../util/ImageBlobCache', async importOriginal => ({
    ...await importOriginal(),
    cacheGet: vi.fn(),
}));

describe('TorrentMaster cached photo lifetime', () => {
    afterEach(() => vi.unstubAllGlobals());

    function setup() {
        const createObjectURL = vi.fn(() => 'blob:cached');
        const revokeObjectURL = vi.fn();
        class MockURL extends URL {}
        MockURL.createObjectURL = createObjectURL;
        MockURL.revokeObjectURL = revokeObjectURL;
        vi.stubGlobal('URL', MockURL);
        cacheGet.mockReset().mockResolvedValue(new Blob(['photo'], { type: 'image/jpeg' }));
        const master = Object.create(TorrentMaster.prototype);
        master.emitter = new EventEmitter();
        master.torrentDeletion = { handlePhotoDeleteEvent: vi.fn() };
        master.serverFallback = { unwatch: vi.fn() };
        master.syncWithPhotoEvents();
        return { master, createObjectURL, revokeObjectURL };
    }

    const photo = infoHash => ({ infoHash, fileName: 'photo.jpg', fileType: 'image/jpeg' });

    it('reuses the cached file and object URL across room resyncs', async () => {
        const { master, createObjectURL, revokeObjectURL } = setup();
        const first = photo('hash-photo.jpg');
        const resynced = photo(first.infoHash);
        await master.serveCachedPhotos([first]);
        await master.serveCachedPhotos([resynced]);
        expect(resynced.img).toBe(first.img);
        expect(resynced.cachedFile).toBe(first.cachedFile);
        expect(cacheGet).toHaveBeenCalledOnce();
        expect(createObjectURL).toHaveBeenCalledOnce();
        expect(revokeObjectURL).not.toHaveBeenCalled();
    });

    it.each(['string', 'object'])('releases only the deleted cache entry before handling a %s deletion', async payload => {
        const { master, revokeObjectURL } = setup();
        const deleted = photo('hash-deleted.jpg');
        const kept = photo('hash-kept.jpg');
        await master.serveCachedPhotos([deleted, kept]);
        master.torrentDeletion.handlePhotoDeleteEvent.mockImplementation(infoHash => {
            expect(infoHash).toBe(deleted.infoHash);
            expect(master._cachedPhotos.has(infoHash)).toBe(false);
            expect(revokeObjectURL).toHaveBeenCalledWith(deleted.img);
        });

        master.emitter.emit('photos', { type: 'delete', item: payload === 'string' ? deleted.infoHash : deleted });

        expect(revokeObjectURL).toHaveBeenCalledOnce();
        expect(master._cachedPhotos.has(kept.infoHash)).toBe(true);
        expect(master.torrentDeletion.handlePhotoDeleteEvent).toHaveBeenCalledOnce();
        expect(master.serverFallback.unwatch).toHaveBeenCalledWith(deleted.infoHash);
    });

    it('handles deletion when no photo has been cached', () => {
        const { master, revokeObjectURL } = setup();
        master.emitter.emit('photos', { type: 'delete', item: 'uncached' });
        expect(revokeObjectURL).not.toHaveBeenCalled();
        expect(master.torrentDeletion.handlePhotoDeleteEvent).toHaveBeenCalledWith('uncached');
    });
});
