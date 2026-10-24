import { describe, it, expect, vi, afterEach } from 'vitest';
import EventEmitter from 'eventemitter3';
import TorrentAddition from '../TorrentAddition';
import RoomsService from '../../RoomsService';
import { FIRST_CHUNK_BYTES } from '../ServerCopyLimits';

vi.mock('../../util/ImageBlobCache', () => ({ cachePut: vi.fn().mockResolvedValue() }));

describe('sharing and server copies', () => {
    it('hands each seeded file, paired with its shared compound hash, to the pinning policy', async () => {
        const emitter = new EventEmitter();
        const files = ['a.mp4', 'b.mp4'].map(name => new File([name], name, { type: 'video/mp4' }));
        const torrent = Object.assign(new EventEmitter(), {
            infoHash: 'basehash', magnetURI: 'magnet:test',
            files: files.slice().reverse().map(file => ({ name: file.name, path: 'folder/' + file.name }))
        });
        let finishShare;
        const service = {
            share: vi.fn(photos => {
                // RoomsService.share encodes its input before sending it.
                photos.forEach(photo => { photo.infoHash = encodeURIComponent(photo.infoHash); });
                return new Promise(resolve => { finishShare = resolve; });
            }),
            uploadServerCopy: vi.fn()
        };
        const master = {
            client: { peerId: 'owner' }, emitter,
            serverPinning: { shared: vi.fn() },
            addSeedOrGetTorrent: vi.fn((action, input, ready) => { ready(torrent); return torrent; })
        };
        const addition = new TorrentAddition(service, {}, emitter, master);
        addition.storeTorrent = vi.fn().mockResolvedValue(torrent);
        let photos;
        emitter.on('photos', event => { if (event.type === 'add') photos = event.item; });

        await addition.seed(files);
        // Storage follows torrent order, which differs from the original photo order.
        expect(photos[0].infoHash).toBe('basehash-folder/b.mp4');
        expect(master.serverPinning.shared).not.toHaveBeenCalled();
        finishShare([]);

        await vi.waitFor(() => expect(master.serverPinning.shared).toHaveBeenCalledOnce());
        expect(master.serverPinning.shared).toHaveBeenCalledWith([
            { infoHash: 'basehash-folder/a.mp4', blob: files[0] },
            { infoHash: 'basehash-folder/b.mp4', blob: files[1] }
        ]);
        // Nothing goes to the server unless someone needs it.
        expect(service.uploadServerCopy).not.toHaveBeenCalled();
    });
});

describe('RoomsService.uploadServerCopy', () => {
    const service = () => ({
        url: '/api/rooms', id: 'room', sessionId: 's1', sessionToken: 'tok',
        sessionHeaders: RoomsService.prototype.sessionHeaders,
        blobUrl: RoomsService.prototype.blobUrl,
    });
    const upload = (svc, ...args) => RoomsService.prototype.uploadServerCopy.call(svc, ...args);
    const json = (status, body) => ({ ok: status < 300, status, json: async () => body });
    const blob = new Blob([new Uint8Array(FIRST_CHUNK_BYTES + 100)], { type: 'image/jpeg' });
    let fetchMock;

    afterEach(() => fetchMock?.mockRestore());

    it('sends a small first chunk then the rest, proving the session', async () => {
        fetchMock = vi.spyOn(globalThis, 'fetch')
            .mockResolvedValueOnce(json(200, { received: FIRST_CHUNK_BYTES, complete: false }))
            .mockResolvedValueOnce(json(200, { received: blob.size, complete: true }));
        const progress = vi.fn();

        await expect(upload(service(), 'hash-folder/a.jpg', blob, { onProgress: progress })).resolves.toEqual({ status: 'stored', size: blob.size });

        const [firstUrl, first] = fetchMock.mock.calls[0];
        expect(firstUrl).toBe(`/api/rooms/room/photos/blob?infoHash=hash-folder%2Fa.jpg&offset=0&size=${blob.size}`);
        expect(first.method).toBe('PUT');
        expect(first.headers).toEqual({ 'X-Session-Id': 's1', 'X-Session-Token': 'tok', 'Content-Type': 'image/jpeg' });
        expect(first.body.size).toBe(FIRST_CHUNK_BYTES);
        expect(fetchMock.mock.calls[1][0]).toContain(`&offset=${FIRST_CHUNK_BYTES}&`);
        expect(fetchMock.mock.calls[1][1].body.size).toBe(100);
        expect(progress).toHaveBeenLastCalledWith(blob.size, blob.size);
    });

    it('resumes where the server got to', async () => {
        fetchMock = vi.spyOn(globalThis, 'fetch')
            .mockResolvedValueOnce(json(409, { code: 'OFFSET', received: FIRST_CHUNK_BYTES }))
            .mockResolvedValueOnce(json(200, { received: blob.size, complete: true }));
        await expect(upload(service(), 'h', blob)).resolves.toMatchObject({ status: 'stored' });
        expect(fetchMock.mock.calls[1][0]).toContain(`&offset=${FIRST_CHUNK_BYTES}&`);
    });

    it('stops when the copy exists or someone else is sending it', async () => {
        fetchMock = vi.spyOn(globalThis, 'fetch').mockResolvedValueOnce(json(409, { exists: true }));
        await expect(upload(service(), 'h', blob)).resolves.toEqual({ status: 'exists' });
        fetchMock.mockResolvedValueOnce(json(409, { uploading: true }));
        await expect(upload(service(), 'h', blob)).resolves.toEqual({ status: 'busy' });
        fetchMock.mockResolvedValueOnce(json(413, { error: 'too big' }));
        await expect(upload(service(), 'h', blob)).resolves.toMatchObject({ status: 'refused', code: 413 });
    });

    it('retries a lost connection, then reports where it was cut off', async () => {
        fetchMock = vi.spyOn(globalThis, 'fetch')
            .mockResolvedValueOnce(json(200, { received: FIRST_CHUNK_BYTES, complete: false }))
            .mockRejectedValue(new TypeError('Failed to fetch'));
        await expect(upload(service(), 'h', blob, { retries: 2, wait: 0 }))
            .resolves.toEqual({ status: 'interrupted', received: FIRST_CHUNK_BYTES });
        expect(fetchMock).toHaveBeenCalledTimes(4);
    });

    it('treats a struggling server as an interruption, not a refusal', async () => {
        fetchMock = vi.spyOn(globalThis, 'fetch').mockResolvedValue(json(503, {}));
        await expect(upload(service(), 'h', blob, { retries: 1, wait: 0 }))
            .resolves.toEqual({ status: 'interrupted', received: 0 });
        expect(fetchMock).toHaveBeenCalledTimes(2);
    });

    it('treats a lost session as an interruption: rejoining fixes it', async () => {
        fetchMock = vi.spyOn(globalThis, 'fetch').mockResolvedValueOnce(json(403, {}));
        await expect(upload(service(), 'h', blob)).resolves.toEqual({ status: 'interrupted', received: 0 });
    });
});

describe('RoomsService.fetchServerCopy', () => {
    const service = { url: '/api/rooms', id: 'room', sessionHeaders: () => ({}), blobUrl: () => '/copy' };
    const fetchCopy = (...args) => RoomsService.prototype.fetchServerCopy.call(service, ...args);
    let fetchMock;

    afterEach(() => fetchMock?.mockRestore());

    it('reports bytes as the copy streams in', async () => {
        const chunks = [new Uint8Array([1, 2]), new Uint8Array([3, 4, 5])];
        const reader = { read: vi.fn(async () => (chunks.length ? { done: false, value: chunks.shift() } : { done: true })) };
        fetchMock = vi.spyOn(globalThis, 'fetch').mockResolvedValue({
            ok: true,
            headers: new Map([['Content-Length', '5'], ['Content-Type', 'image/jpeg']]),
            body: { getReader: () => reader },
        });
        const progress = vi.fn();
        const blob = await fetchCopy('h', { onProgress: progress });
        expect(progress.mock.calls).toEqual([[2, 5], [5, 5]]);
        expect(blob.size).toBe(5);
        expect(blob.type).toBe('image/jpeg');
    });

    it('falls back to a plain blob without a progress callback', async () => {
        const whole = new Blob(['x']);
        fetchMock = vi.spyOn(globalThis, 'fetch').mockResolvedValue({ ok: true, blob: async () => whole });
        expect(await fetchCopy('h')).toBe(whole);
    });
});

