import { describe, it, expect, vi, beforeEach } from 'vitest';
import EventEmitter from 'eventemitter3';
import TorrentAddition from '../TorrentAddition';
import { fingerprintFile } from '../../gallery/fingerprint';
import { alreadyHave, clearHave } from '../../gallery/alreadyHave';

vi.mock('../../util/ImageBlobCache', () => ({ cachePut: vi.fn().mockResolvedValue() }));

/** Seed `files` against a stand-in torrent and room; resolves to what was shared with the room. */
async function upload(files, secure = false, origFiles = []) {
    const emitter = new EventEmitter();
    const torrent = Object.assign(new EventEmitter(), {
        infoHash: 'basehash', magnetURI: 'magnet:test',
        files: files.map(file => ({ name: file.name, path: 'folder/' + file.name })),
    });
    const service = { share: vi.fn().mockResolvedValue([]), uploadServerCopy: vi.fn().mockResolvedValue({}) };
    const master = {
        client: { peerId: 'owner' }, emitter,
        addSeedOrGetTorrent: vi.fn((action, input, ready) => { ready(torrent); return torrent; }),
    };
    const addition = new TorrentAddition(service, {}, emitter, master);
    addition.storeTorrent = vi.fn().mockResolvedValue(torrent);
    await addition.seed(files, secure, origFiles);
    await vi.waitFor(() => expect(service.share).toHaveBeenCalled());
    return service.share.mock.calls[0][0];
}

describe('upload fingerprints', () => {
    beforeEach(() => clearHave());

    it('shares each photo with its fingerprint and remembers it as yours', async () => {
        const files = ['a.mp4', 'b.mp4'].map(name => new File(['video ' + name], name, { type: 'video/mp4' }));
        const shared = await upload(files);
        const expected = await Promise.all(files.map(fingerprintFile));
        expect(shared.map(photo => photo.fingerprint)).toEqual(expected);
        expect(expected.map(fingerprint => alreadyHave({ fingerprint }))).toEqual(['shared', 'shared']);
    });

    it('gives encrypted shares no fingerprint', async () => {
        const original = new File(['secret'], 'a.jpg', { type: 'image/jpeg' });
        const encrypted = new File(['ciphertext'], 'a.jpg', { type: 'application/octet-stream' });
        const shared = await upload([encrypted], true, [original]);
        expect(shared[0].fingerprint).toBeUndefined();
    });
});
