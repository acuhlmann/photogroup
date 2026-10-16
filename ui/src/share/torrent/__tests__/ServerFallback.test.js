import { describe, it, expect, vi } from 'vitest';
import ServerFallback, { shouldUseServerFallback, isTransferStalled, P2P_STALL_MS } from '../ServerFallback';

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

    it('does nothing while P2P is progressing to completion', async () => {
        const fetchCopy = vi.fn();
        const fallback = new ServerFallback({ fetchCopy, cachePut: vi.fn(), emitter: { emit: vi.fn() }, stallMs: 1, pollMs: 5, now: () => 1000 });
        fallback.watch({ infoHash: 'h2', hasServerCopy: true }, () => ({ progress: 1, done: true }));
        await new Promise(r => setTimeout(r, 30));
        expect(fetchCopy).not.toHaveBeenCalled();
        fallback.stopAll();
    });
});
