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

    it('logs ICE state changes, STUN lookups, TURN allocations, and candidates', () => {
        expect(describeEvent('pcEvent', ['iceconnectionstatechange', 'connected']).text).toBe('iceconnection → connected');
        expect(describeEvent('pcEvent', ['iceconnectionstatechange', ''])).toBeNull();
        expect(describeEvent('pcEvent', ['icecandidate', 'srflx 203.0.113.5:5000'])).toEqual({
            kind: 'stun', text: 'STUN lookup → srflx 203.0.113.5:5000',
        });
        expect(describeEvent('pcEvent', ['icecandidate', 'relay 192.0.2.9:49152'])).toEqual({
            kind: 'turn', text: 'TURN allocate → relay 192.0.2.9:49152',
        });
        expect(describeEvent('localNetwork', [[{ typeDetail: 'host' }, { typeDetail: 'srflx' }]]).text)
            .toBe('2 candidates · host srflx');
    });

    it('distinguishes primary PG tracker from public backup trackers and TURN-relayed linkStats', () => {
        const torrent = { name: 'beach.jpg', infoHash: 'abc' };
        expect(describeEvent('trackerAnnounce', [{ torrent, host: 'photogroup.network' }])).toMatchObject({
            kind: 'trk', text: 'announce beach.jpg · photogroup.network answered',
        });
        expect(describeEvent('trackerAnnounce', [{ torrent, isPublic: true, host: 'tracker.openwebtorrent.com' }])).toMatchObject({
            kind: 'pub', text: 'public WS announce · beach.jpg · tracker.openwebtorrent.com',
        });
        const connected = describeEvent('trackerStatus', [{ isPublic: true, host: 'tracker.btorrent.xyz', status: 'connected' }]);
        const disconnected = describeEvent('trackerStatus', [{ isPublic: true, host: 'tracker.btorrent.xyz', status: 'disconnected' }]);
        expect(connected).toMatchObject({
            kind: 'pub', text: 'public WS tracker.btorrent.xyz · connected',
        });
        expect(disconnected.key).not.toBe(connected.key);
        expect(describeEvent('linkStats', [{
            changed: true, peerId: 'ana12345', local: 'relay', remote: 'srflx', protocol: 'udp', relayProtocol: 'udp', rtt: 42,
        }])).toMatchObject({
            kind: 'turn',
            text: 'TURN relay peer ana12345 · relay ⇄ srflx udp via TURN/udp · rtt 42 ms',
        });
    });

    it('ignores events it does not know', () => {
        expect(describeEvent('somethingElse', [])).toBeNull();
    });
});
