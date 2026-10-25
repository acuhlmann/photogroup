import { describe, it, expect, vi } from 'vitest';
import ScreenAwake, { photosMoving } from './screenAwake';

const me = 'me';
const photo = (extra = {}) => ({ infoHash: 'h', peerId: 'friend', owners: [], ...extra });

describe('photosMoving', () => {
    it('is true while this phone still gets a photo someone here has', () => {
        expect(photosMoving({ me, photos: [photo()], peers: [{ peerId: 'friend' }] })).toBe(true);
        expect(photosMoving({ me, photos: [photo({ hasServerCopy: true })], peers: [] })).toBe(true);
    });

    it('is true while someone here, in front, lacks a photo this phone has', () => {
        const mine = photo({ peerId: me });
        expect(photosMoving({ me, photos: [mine], peers: [{ peerId: me }, { peerId: 'friend' }] })).toBe(true);
        expect(photosMoving({ me, photos: [mine], peers: [{ peerId: 'friend', away: true }] })).toBe(false);
    });

    it('is false when everyone has everything, or nobody can send it', () => {
        const shared = photo({ owners: [{ peerId: me }] });
        expect(photosMoving({ me, photos: [shared], peers: [{ peerId: 'friend' }] })).toBe(false);
        expect(photosMoving({ me, photos: [photo()], peers: [] })).toBe(false);
        expect(photosMoving({ me, photos: [photo({ owners: [{ peerId: me, loading: true }] })], peers: [{ peerId: 'friend' }] })).toBe(true);
    });
});

describe('photosMoving with Data saver', () => {
    it('does not count a photo only previewed, here or on another phone', () => {
        expect(photosMoving({ me, dataSaver: true, photos: [photo()], peers: [{ peerId: 'friend' }] })).toBe(false);
        expect(photosMoving({ me, dataSaver: true, photos: [photo({ owners: [{ peerId: me, loading: true }] })], peers: [{ peerId: 'friend' }] })).toBe(true);
        expect(photosMoving({ me, photos: [photo({ peerId: me })], peers: [{ peerId: 'saver', dataSaver: true }] })).toBe(false);
    });
});

describe('ScreenAwake', () => {
    function setup(moving) {
        const lock = { release: vi.fn().mockResolvedValue(), addEventListener: vi.fn() };
        const nav = { wakeLock: { request: vi.fn().mockResolvedValue(lock) } };
        const doc = { hidden: false, addEventListener: vi.fn(), removeEventListener: vi.fn() };
        const state = { photos: moving ? [photo()] : [] };
        const master = { client: { peerId: me }, peers: { items: [{ peerId: 'friend' }] }, roomPhotos: { all: () => state.photos } };
        return { awake: new ScreenAwake({ master, nav, doc }), lock, nav, doc, state };
    }

    it('keeps the screen on while photos move and lets go after', async () => {
        const { awake, lock, nav, state } = setup(true);
        await awake.check();
        expect(nav.wakeLock.request).toHaveBeenCalledWith('screen');
        await awake.check();
        expect(nav.wakeLock.request).toHaveBeenCalledTimes(1);
        state.photos = [];
        await awake.check();
        expect(lock.release).toHaveBeenCalled();
    });

    it('lets go of a lock granted after it stopped', async () => {
        const { awake, lock } = setup(true);
        const pending = awake.check();
        awake.stop();
        await pending;
        expect(lock.release).toHaveBeenCalled();
        expect(awake.lock).toBeNull();
    });

    it('does not ask in the background', async () => {
        const { awake, nav, doc } = setup(true);
        doc.hidden = true;
        await awake.check();
        expect(nav.wakeLock.request).not.toHaveBeenCalled();
    });
});
