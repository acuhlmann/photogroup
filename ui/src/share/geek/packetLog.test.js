import { describe, it, expect } from 'vitest';
import { describeEvent } from './packetLog';

describe('describeEvent', () => {
    it('logs handshakes with the remote address', () => {
        expect(describeEvent('wire', [{ type: 'webrtc' }, '198.51.100.4:1234', { name: 'beach.jpg' }]))
            .toEqual({ kind: 'wire', text: 'handshake 198.51.100.4:1234 · beach.jpg · webrtc' });
    });

    it('logs bytes in and out per photo', () => {
        const torrent = { name: 'beach.jpg', infoHash: 'abc' };
        expect(describeEvent('downloadProgress', [{ torrent, speed: '1.2 MB/s', progress: 45.4 }]))
            .toEqual({ kind: 'rx', key: 'rxabc', text: '1.2 MB/s ← beach.jpg 45%' });
        expect(describeEvent('uploadProgress', [{ torrent, speed: '800 kB/s' }]))
            .toEqual({ kind: 'tx', key: 'txabc', text: '800 kB/s → beach.jpg' });
    });

    it('logs people joining and leaving, but not every update', () => {
        expect(describeEvent('peers', [{ type: 'add', item: { name: 'Ana', peerId: 'p1234567890' } }]).text)
            .toBe('+ Ana joined (p1234567)');
        expect(describeEvent('peers', [{ type: 'delete', item: 'p1234567890' }]).text).toBe('− p1234567 left');
        expect(describeEvent('peers', [{ type: 'update', item: {} }])).toBeNull();
    });

    it('summarises the topology by connection type', () => {
        expect(describeEvent('peerConnections', [[{ connectionType: 'p2p' }, { connectionType: 'p2p' }, { connectionType: 'relay' }]]).text)
            .toBe('topology 2 p2p, 1 relay');
        expect(describeEvent('peerConnections', [[]]).text).toBe('topology no links');
    });

    it('logs new photos with their magnet and room snapshots', () => {
        expect(describeEvent('photos', [{ type: 'add', item: { fileName: 'a.jpg', infoHash: '0123456789abcdef' } }]).text)
            .toBe('+ a.jpg magnet 0123456789');
        // The app sends adds as a list.
        expect(describeEvent('photos', [{ type: 'add', item: [{ fileName: 'a.jpg', infoHash: '0123456789abcdef' }, {}] }]).text)
            .toBe('+ a.jpg magnet 0123456789 +1');
        expect(describeEvent('photos', [{ type: 'all', item: [{}, {}] }]).text).toBe('room snapshot · 2 photos');
        expect(describeEvent('photos', [{ type: 'updateOwner', item: {} }])).toBeNull();
    });

    it('logs whole pieces with the peer they moved to or from', () => {
        const torrent = { name: 'beach.jpg', infoHash: 'abc' };
        const entry = describeEvent('pieceReceived', [{ torrent, index: 2, total: 12, peerId: 'ana12345678' }]);
        expect(entry).toMatchObject({ kind: 'rx', text: 'piece 3/12 ← peer ana12345 · beach.jpg' });
        expect(describeEvent('pieceSent', [{ torrent, index: 0, total: 12, peerId: 'ben' }]).text).toBe('piece 1/12 → peer ben · beach.jpg');
    });

    it('logs ICE state changes and candidates', () => {
        expect(describeEvent('pcEvent', ['iceconnectionstatechange', 'connected']).text).toBe('iceconnection → connected');
        expect(describeEvent('pcEvent', ['iceconnectionstatechange', ''])).toBeNull();
        expect(describeEvent('localNetwork', [[{ typeDetail: 'host' }, { typeDetail: 'srflx' }]]).text)
            .toBe('2 candidates · host srflx');
    });

    it('ignores events it does not know', () => {
        expect(describeEvent('somethingElse', [])).toBeNull();
    });
});
