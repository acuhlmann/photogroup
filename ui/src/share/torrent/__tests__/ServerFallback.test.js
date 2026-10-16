import { describe, it, expect, vi } from 'vitest';
import ServerFallback, { shouldUseServerFallback, P2P_STALL_MS } from '../ServerFallback';

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
});

describe('ServerFallback', () => {
    it('delivers the server copy, caches it and emits torrentReady when stalled', async () => {
        const emitter = { emit: vi.fn() };
        const cachePut = vi.fn().mockResolvedValue();
        const fallback = new ServerFallback({
            fetchCopy: vi.fn().mockResolvedValue(new Blob(['jpg'], { type: 'image/jpeg' })),
            cachePut, emitter, stallMs: 100, pollMs: 5, now: () => 1000
        });
        const photo = { infoHash: 'h1', fileName: 'a.jpg', fileType: 'image/jpeg', hasServerCopy: true };
        fallback.watch(photo, () => ({ progress: 0, done: false }));
        await vi.waitFor(() => expect(emitter.emit).toHaveBeenCalledWith('torrentReady', [photo]));
        expect(photo.fromServerCopy).toBe(true);
        expect(cachePut).toHaveBeenCalledWith('h1', expect.anything());
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
