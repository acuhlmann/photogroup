import { describe, it, expect } from 'vitest';
import { thumbProgress, piecesShare, copyCaption } from './mediaProgress';

const bits = have => ({ get: index => have.includes(index) });
const photo = { name: 'beach.jpg', progress: 0.25, _startPiece: 0, _endPiece: 3 };
const torrent = (extra = {}) => ({
    infoHash: 'abc', progress: 0.2, pieces: [1, 2, 3, 4, 5],
    files: [photo, { name: 'Thumbnail beach.jpg', _startPiece: 4, _endPiece: 4 }], wires: [], ...extra,
});
const tile = { infoHash: 'abc', fileName: 'beach.jpg', loading: true };

describe('thumbProgress', () => {
    it("reads this device's photo from its own torrent file", () => {
        const got = thumbProgress({ tile, deviceId: 'me', arriving: true }, { myPeerId: 'me', torrents: [torrent()] });
        expect(got).toEqual({ value: 0.25, via: 'p2p' });
    });

    it('shows the server copy download when the photo comes that way', () => {
        const ledger = { get: () => ({ serverStage: { direction: 'down', stage: 'downloading', loaded: 600, total: 1000 } }) };
        const got = thumbProgress({ tile, deviceId: 'me', arriving: true }, { myPeerId: 'me', torrents: [torrent()], ledger });
        expect(got).toEqual({ value: 0.6, via: 'server' });
    });

    it("reads another device's share from the pieces its wire says it has", () => {
        const wires = [{ peerId: 'ana', peerPieces: bits([0, 1, 4]) }];
        const got = thumbProgress({ tile, deviceId: 'ana', arriving: true }, { myPeerId: 'me', torrents: [torrent({ wires })] });
        // Only the photo's own pieces (0..3) count, not the preview's.
        expect(got).toEqual({ value: 0.5, via: 'p2p' });
    });

    it('says "unknown" for a device with no wire to us, and nothing once a photo is all there', () => {
        expect(thumbProgress({ tile, deviceId: 'ben', arriving: true }, { myPeerId: 'me', torrents: [torrent()] }))
            .toEqual({ value: null, via: 'p2p' });
        expect(thumbProgress({ tile: { ...tile, loading: false }, deviceId: 'me', arriving: false }, { myPeerId: 'me' })).toBe(null);
        const wires = [{ peerId: 'ana', peerPieces: bits([0, 1, 2, 3]) }];
        expect(thumbProgress({ tile, deviceId: 'ana', arriving: true }, { myPeerId: 'me', torrents: [torrent({ wires })] })).toBe(null);
    });

    it("shows a server copy's upload on the server's shelf", () => {
        const photoOf = () => ({ serverCopySize: 1000, serverCopyReceived: 250 });
        expect(thumbProgress({ tile, deviceId: 'copies', copy: 'uploading' }, { photoOf })).toEqual({ value: 0.25, via: 'server' });
        expect(thumbProgress({ tile, deviceId: 'copies', copy: 'stored' }, { photoOf })).toBe(null);
    });
});

describe('piecesShare', () => {
    it('cannot tell without a bitfield or pieces', () => {
        expect(piecesShare(null, torrent(), photo)).toBe(null);
        expect(piecesShare(bits([0]), { pieces: [] }, photo)).toBe(null);
    });
});

describe('copyCaption', () => {
    it('says how long a stored copy stays, or that one was asked for', () => {
        expect(copyCaption('stored', { serverCopyExpiresAt: 19 * 3600000 + 60000 }, 0)).toBe('19h left');
        expect(copyCaption('stored', { serverCopyExpiresAt: 25 * 60000 }, 0)).toBe('25m left');
        expect(copyCaption('requested')).toBe('asked');
        expect(copyCaption('uploading')).toBe(null);
    });
});
