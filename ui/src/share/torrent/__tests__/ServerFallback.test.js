import { describe, it, expect, vi } from 'vitest';
import ServerFallback, { shouldUseServerFallback, isTransferStalled, holdersAllAway, isSharedPhoto, P2P_STALL_MS } from '../ServerFallback';
import { fingerprintFile } from '../../gallery/fingerprint';

describe('shouldUseServerFallback', () => {
    const base = { hasServerCopy: true, done: false, progress: 0.2, startedAt: 0, now: P2P_STALL_MS };
    it('fires only after the stall window with a server copy available', () => {
        expect(shouldUseServerFallback(base)).toBe(true);
        expect(shouldUseServerFallback({ ...base, now: P2P_STALL_MS - 1 })).toBe(false);
        expect(shouldUseServerFallback({ ...base, hasServerCopy: false })).toBe(false);
    });
    it('never fires when P2P finished or completed', () => {
        expect(shouldUseServerFallback({ ...base, done: true })).toBe(false);
        expect(shouldUseServerFallback({ ...base, progress: 1 })).toBe(false);
    });
    it('measures the stall from last progress, so slow-but-moving transfers are left alone', () => {
        // Started long ago but progressed just now: not stalled.
        expect(shouldUseServerFallback({ ...base, startedAt: 0, lastProgressAt: P2P_STALL_MS - 1, now: P2P_STALL_MS })).toBe(false);
        expect(shouldUseServerFallback({ ...base, startedAt: 0, lastProgressAt: 0, now: P2P_STALL_MS })).toBe(true);
        expect(isTransferStalled({ progress: 0.5, lastProgressAt: 0, now: P2P_STALL_MS })).toBe(true);
        expect(isTransferStalled({ progress: 0.5, lastProgressAt: P2P_STALL_MS, now: P2P_STALL_MS })).toBe(false);
    });
});

describe('holdersAllAway', () => {
    it('only counts when someone has the photo and none of them is in front', () => {
        expect(holdersAllAway({ holders: 2, activeHolders: 0 })).toBe(true);
        expect(holdersAllAway({ holders: 2, activeHolders: 1 })).toBe(false);
        expect(holdersAllAway({ holders: 0, activeHolders: 0 })).toBe(false);
        expect(holdersAllAway({})).toBe(false);
    });
});

describe('isSharedPhoto', () => {
    it("checks a server copy against the sharer's fingerprint", async () => {
        const shared = new File(['the photo'], 'a.jpg');
        const photo = { fingerprint: await fingerprintFile(shared) };
        await expect(isSharedPhoto(photo, shared)).resolves.toBe(true);
        await expect(isSharedPhoto(photo, new Blob(['something else']))).resolves.toBe(false);
        // Encrypted shares carry no fingerprint: nothing to check.
        await expect(isSharedPhoto({}, new Blob(['ciphertext']))).resolves.toBe(true);
    });
});

describe('ServerFallback', () => {
    it('delivers the server copy, caches it and emits torrentReady when stalled', async () => {
        const emitter = { emit: vi.fn() };
        const cachePut = vi.fn().mockResolvedValue();
        let clock = 1000;
        const fallback = new ServerFallback({
            fetchCopy: vi.fn().mockResolvedValue(new Blob(['jpg'], { type: 'image/jpeg' })),
            cachePut, emitter, stallMs: 100, pollMs: 5, now: () => (clock += 200)
        });
        const photo = { infoHash: 'h1', fileName: 'a.jpg', fileType: 'image/jpeg', hasServerCopy: true };
        fallback.watch(photo, () => ({ progress: 0, done: false }));
        await vi.waitFor(() => expect(emitter.emit).toHaveBeenCalledWith('torrentReady', [photo]));
        expect(photo.fromServerCopy).toBe(true);
        expect(cachePut).toHaveBeenCalledWith('h1', expect.anything());
        fallback.stopAll();
    });

    it('does not fetch while progress keeps advancing, even past the old start-based deadline', async () => {
        let clock = 0;
        let progress = 0;
        const fetchCopy = vi.fn().mockResolvedValue(new Blob(['x']));
        const fallback = new ServerFallback({ fetchCopy, cachePut: vi.fn(), emitter: { emit: vi.fn() }, stallMs: 100, pollMs: 5, now: () => clock });
        fallback.watch({ infoHash: 'h3', hasServerCopy: true }, () => { progress += 0.1; return { progress, done: false }; });
        for (let i = 0; i < 10; i++) { clock += 50; await new Promise(r => setTimeout(r, 12)); }
        expect(fetchCopy).not.toHaveBeenCalled();
        fallback.stopAll();
    });

    it('does not fetch while bytes keep arriving inside a piece that is not verified yet', async () => {
        // A big clip has big pieces: on a slow link, progress (verified
        // pieces) can stand still for longer than the stall window while
        // blocks of the next piece keep arriving.
        let clock = 0;
        let received = 0;
        const fetchCopy = vi.fn().mockResolvedValue(new Blob(['x']));
        const fallback = new ServerFallback({ fetchCopy, cachePut: vi.fn(), emitter: { emit: vi.fn() }, stallMs: 100, pollMs: 5, now: () => clock });
        fallback.watch({ infoHash: 'h3b', hasServerCopy: true }, () => { received += 16384; return { progress: 0.2, received, done: false }; });
        for (let i = 0; i < 10; i++) { clock += 50; await new Promise(r => setTimeout(r, 12)); }
        expect(fetchCopy).not.toHaveBeenCalled();
        fallback.stopAll();
    });

    it('still falls back when bytes arrive but no piece ever verifies', async () => {
        let clock = 0;
        let received = 0;
        const fetchCopy = vi.fn().mockResolvedValue(new Blob(['x']));
        const fallback = new ServerFallback({ fetchCopy, cachePut: vi.fn(), emitter: { emit: vi.fn() }, stallMs: 100, verifyStallMs: 400, pollMs: 5, now: () => clock });
        fallback.watch({ infoHash: 'h3c', hasServerCopy: true }, () => { received += 16384; return { progress: 0.2, received, done: false }; });
        for (let i = 0; i < 12; i++) { clock += 50; await new Promise(r => setTimeout(r, 12)); }
        expect(fetchCopy).toHaveBeenCalled();
        fallback.stopAll();
    });

    it('fetchNow delivers immediately without waiting for the stall window', async () => {
        const emitter = { emit: vi.fn() };
        const fallback = new ServerFallback({
            fetchCopy: vi.fn().mockResolvedValue(new Blob(['jpg'], { type: 'image/jpeg' })),
            cachePut: vi.fn().mockResolvedValue(), emitter, stallMs: 60000, pollMs: 60000, now: () => 0
        });
        const photo = { infoHash: 'h4', fileName: 'b.jpg', fileType: 'image/jpeg', hasServerCopy: true };
        fallback.watch(photo, () => ({ progress: 0, done: false }));
        await expect(fallback.fetchNow('h4')).resolves.toBe(true);
        expect(emitter.emit).toHaveBeenCalledWith('torrentReady', [photo]);
        await expect(fallback.fetchNow('unknown')).resolves.toBe(false);
        fallback.stopAll();
    });

    it('asks for a copy when stalled without one, again only after a while', async () => {
        let clock = 0;
        const requestCopy = vi.fn().mockResolvedValue({});
        const fetchCopy = vi.fn();
        const fallback = new ServerFallback({ fetchCopy, requestCopy, cachePut: vi.fn(), emitter: { emit: vi.fn() },
            stallMs: 100, pollMs: 60000, rerequestMs: 1000, now: () => clock });
        fallback.watch({ infoHash: 'h5' }, () => ({ progress: 0, done: false, hasServerCopy: false }));

        clock = 50;
        await fallback._check('h5');
        expect(requestCopy).not.toHaveBeenCalled(); // P2P still has time
        clock = 100;
        await fallback._check('h5');
        expect(requestCopy).toHaveBeenCalledWith('h5');
        clock = 500;
        await fallback._check('h5');
        expect(requestCopy).toHaveBeenCalledTimes(1);
        clock = 1100;
        await fallback._check('h5');
        expect(requestCopy).toHaveBeenCalledTimes(2);
        expect(fetchCopy).not.toHaveBeenCalled();
        fallback.stopAll();
    });

    it('fetches an existing copy at once when everyone who has the photo is away', async () => {
        const fetchCopy = vi.fn().mockResolvedValue(new Blob(['jpg'], { type: 'image/jpeg' }));
        const fallback = new ServerFallback({ fetchCopy, cachePut: vi.fn(), emitter: { emit: vi.fn() }, stallMs: 60000, pollMs: 60000, now: () => 0 });
        let state = { progress: 0, done: false, hasServerCopy: true, holders: 1, activeHolders: 1 };
        fallback.watch({ infoHash: 'h6', fileName: 'c.jpg' }, () => state);
        await fallback._check('h6');
        expect(fetchCopy).not.toHaveBeenCalled(); // someone is in front: let P2P try
        state = { ...state, activeHolders: 0 };
        await fallback._check('h6');
        expect(fetchCopy).toHaveBeenCalledWith('h6', expect.anything());
    });

    it("trusts the room's view of the copy over the photo it started with", async () => {
        const fetchCopy = vi.fn().mockResolvedValue(null);
        const requestCopy = vi.fn().mockResolvedValue({});
        const fallback = new ServerFallback({ fetchCopy, requestCopy, cachePut: vi.fn(), emitter: { emit: vi.fn() }, stallMs: 0, pollMs: 60000, now: () => 1 });
        fallback.watch({ infoHash: 'h7', hasServerCopy: true }, () => ({ progress: 0, hasServerCopy: false }));
        await fallback._check('h7');
        expect(fetchCopy).not.toHaveBeenCalled();
        expect(requestCopy).toHaveBeenCalled();
    });

    it('asks again after waking up, and asks right away when tapped', async () => {
        let clock = 0;
        const requestCopy = vi.fn().mockResolvedValue({});
        const fallback = new ServerFallback({ fetchCopy: vi.fn(), requestCopy, cachePut: vi.fn(), emitter: { emit: vi.fn() },
            stallMs: 100, pollMs: 60000, rerequestMs: 60000, now: () => clock });
        fallback.watch({ infoHash: 'h8' }, () => ({ progress: 0, hasServerCopy: false }));
        await expect(fallback.fetchNow('h8')).resolves.toBe(true);
        expect(requestCopy).toHaveBeenCalledTimes(1);

        clock = 5000;
        fallback.resetClocks();
        await fallback._check('h8');
        expect(requestCopy).toHaveBeenCalledTimes(1); // fresh stall window first
        clock = 5100;
        await fallback._check('h8');
        expect(requestCopy).toHaveBeenCalledTimes(2);
        fallback.stopAll();
    });

    it('delivers onto the photo object it was given, with later news merged', async () => {
        const emitter = { emit: vi.fn() };
        const fallback = new ServerFallback({ fetchCopy: vi.fn().mockResolvedValue(new Blob(['x'])), cachePut: vi.fn(), emitter, stallMs: 0, pollMs: 60000, now: () => 1 });
        const photo = { infoHash: 'h9', fileName: 'd.jpg', fileType: 'image/jpeg' };
        fallback.watch(photo, () => ({ progress: 0 }));
        expect(fallback.update({ infoHash: 'h9', hasServerCopy: true })).toBe(true);
        await fallback._check('h9');
        expect(emitter.emit).toHaveBeenCalledWith('torrentReady', [photo]);
        expect(photo.hasServerCopy).toBe(true);
        expect(photo.file.name).toBe('d.jpg');
    });

    it("refuses a copy that isn't the shared photo, and doesn't refetch it every poll", async () => {
        let clock = 0;
        const emitter = { emit: vi.fn() };
        const fetchCopy = vi.fn().mockResolvedValue(new Blob(['not the photo']));
        const verify = vi.fn().mockResolvedValue(false);
        const fallback = new ServerFallback({ fetchCopy, verify, cachePut: vi.fn(), emitter, stallMs: 0, pollMs: 60000, rerequestMs: 1000, now: () => clock });
        const photo = { infoHash: 'h10', fileName: 'e.jpg', fingerprint: '13:abc' };
        fallback.watch(photo, () => ({ progress: 0, hasServerCopy: true }));

        await fallback._check('h10');
        expect(verify).toHaveBeenCalledWith(photo, expect.any(Blob));
        expect(emitter.emit).not.toHaveBeenCalledWith('torrentReady', expect.anything());
        expect(emitter.emit).toHaveBeenCalledWith('serverCopy', expect.objectContaining({ stage: 'rejected' }));
        expect(photo.file).toBeUndefined();
        clock = 500;
        await fallback._check('h10');
        expect(fetchCopy).toHaveBeenCalledTimes(1);
        clock = 1000;
        await fallback._check('h10');
        expect(fetchCopy).toHaveBeenCalledTimes(2);
        fallback.stopAll();
    });

    it('does nothing while P2P is progressing to completion', async () => {
        const fetchCopy = vi.fn();
        const fallback = new ServerFallback({ fetchCopy, cachePut: vi.fn(), emitter: { emit: vi.fn() }, stallMs: 1, pollMs: 5, now: () => 1000 });
        fallback.watch({ infoHash: 'h2', hasServerCopy: true }, () => ({ progress: 1, done: true }));
        await new Promise(r => setTimeout(r, 30));
        expect(fetchCopy).not.toHaveBeenCalled();
        fallback.stopAll();
    });

    it('reports each stage of the fallback, with progress and why', async () => {
        const events = [];
        const emitter = { emit: (name, event) => { if (name === 'serverCopy') events.push(event); } };
        const fetchCopy = vi.fn(async (infoHash, { onProgress }) => {
            onProgress(2, 4);
            onProgress(4, 4);
            return new Blob(['abcd']);
        });
        const requestCopy = vi.fn().mockResolvedValue({});
        let hasServerCopy = false;
        const fallback = new ServerFallback({ fetchCopy, requestCopy, cachePut: vi.fn(), emitter, stallMs: 10000, pollMs: 60000, now: () => 20000 });
        const photo = { infoHash: 'h11', fileName: 'f.jpg' };
        fallback.watch(photo, () => ({ progress: 0, hasServerCopy }));
        fallback.watched.get('h11').lastProgressAt = 0;

        await fallback._check('h11');
        expect(events.at(-1)).toMatchObject({ stage: 'requested', direction: 'down', why: 'no P2P progress for 10 s' });
        hasServerCopy = true;
        await fallback._check('h11');
        expect(events.map(event => event.stage)).toEqual(['requested', 'downloading', 'downloading', 'downloading', 'verifying', 'done']);
        expect(events[3]).toMatchObject({ loaded: 4, total: 4, name: 'f.jpg' });
    });
});
