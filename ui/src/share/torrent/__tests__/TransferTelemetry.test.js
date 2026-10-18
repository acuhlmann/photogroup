import { describe, it, expect, vi } from 'vitest';
import { EventEmitter } from 'events';
import {
    attachTelemetryLog, classifyCandidatePair, computePhase, formatBytes, formatElapsed,
    probeIcePaths, shortHash, snapshotTorrent,
} from '../TransferTelemetry';

const baseSnap = {
    numPeers: 0, wires: [], hasMetadata: false, pieces: 0, verified: 0,
    downloaded: 0, progress: 0, done: false,
};

describe('TransferTelemetry', () => {
    it('formats hashes, bytes and elapsed time', () => {
        expect(shortHash('0123456789abcdef0123456789abcdef01234567')).toBe('01234567…4567');
        expect(shortHash('abc')).toBe('abc');
        expect(formatBytes(0)).toBe('0 B');
        expect(formatBytes(16384)).toBe('16.0 KiB');
        expect(formatBytes(3 * 1024 * 1024)).toBe('3.0 MiB');
        expect(formatElapsed(1234)).toBe('+1.2s');
        expect(formatElapsed(65000)).toBe('+1m05s');
    });

    it('walks the phases as the transfer progresses', () => {
        expect(computePhase(null)).toBe('signal');
        expect(computePhase(baseSnap)).toBe('signal');
        expect(computePhase(baseSnap, { announced: true })).toBe('discover');
        expect(computePhase(baseSnap, { announced: true, peerOffered: true })).toBe('handshake');
        expect(computePhase({ ...baseSnap, wires: [{}] })).toBe('metadata');
        expect(computePhase({ ...baseSnap, wires: [{}], hasMetadata: true, downloaded: 10 })).toBe('pieces');
        expect(computePhase({ ...baseSnap, done: true })).toBe('verify');
    });

    it('snapshots a torrent, counting verified pieces from the bitfield', () => {
        const have = new Set([0, 2]);
        const snap = snapshotTorrent({
            infoHash: 'ab'.repeat(20), numPeers: 2, pieces: [null, {}, null], pieceLength: 16384,
            bitfield: { get: i => have.has(i) }, length: 40000, downloaded: 32768, progress: 0.8,
            announce: ['wss://tracker'],
            wires: [{ type: 'webrtc', peerId: 'cd'.repeat(20), downloaded: 32768, peerChoking: false,
                peerExtendedHandshake: { v: 'WebTorrent 3', m: { ut_metadata: 1, ut_pex: 2 } } }],
        });
        expect(snap.verified).toBe(2);
        expect(snap.pieces).toBe(3);
        expect(snap.hasMetadata).toBe(true);
        expect(snap.wires[0]).toMatchObject({ type: 'webrtc', client: 'WebTorrent 3', extensions: ['ut_metadata', 'ut_pex'] });
        expect(snapshotTorrent({})).toBeNull();
    });

    it('classifies the selected ICE pair', () => {
        const stats = new Map([
            ['T', { id: 'T', type: 'transport', selectedCandidatePairId: 'P' }],
            ['P', { id: 'P', type: 'candidate-pair', localCandidateId: 'L', remoteCandidateId: 'R', currentRoundTripTime: 0.042 }],
            ['L', { id: 'L', type: 'local-candidate', candidateType: 'srflx', protocol: 'udp' }],
            ['R', { id: 'R', type: 'remote-candidate', candidateType: 'host', address: '203.0.113.7', port: 5000 }],
        ]);
        expect(classifyCandidatePair(stats)).toMatchObject({
            path: 'srflx', relayed: false, rttMs: 42, protocol: 'udp', remoteAddress: '203.0.113.7',
        });

        const relayed = [
            { id: 'P', type: 'candidate-pair', selected: true, state: 'succeeded', localCandidateId: 'L', remoteCandidateId: 'R' },
            { id: 'L', candidateType: 'relay' }, { id: 'R', candidateType: 'host' },
        ];
        expect(classifyCandidatePair(relayed)).toMatchObject({ path: 'relay', relayed: true, label: 'TURN relay' });
        expect(classifyCandidatePair([])).toBeNull();
    });

    it('probes RTCPeerConnections hanging off webtorrent peers', async () => {
        const stats = [
            { id: 'P', type: 'candidate-pair', nominated: true, state: 'succeeded', localCandidateId: 'L', remoteCandidateId: 'R' },
            { id: 'L', candidateType: 'host' }, { id: 'R', candidateType: 'host' },
        ];
        const torrent = { _peers: new Map([
            ['a', { conn: { _pc: { getStats: async () => stats } } }],
            ['b', { conn: { _pc: { getStats: async () => { throw new Error('closed'); } } } }],
            ['c', { conn: null }],
        ]) };
        const found = await probeIcePaths(torrent);
        expect(found).toEqual([expect.objectContaining({ id: 'a', path: 'host', label: 'direct LAN' })]);
    });

    it('logs protocol events and detaches cleanly', () => {
        const torrent = new EventEmitter();
        torrent.infoHash = 'ef'.repeat(20);
        torrent.pieces = [1, 2];
        torrent.pieceLength = 16384;
        torrent.length = 30000;
        torrent.files = [{}];
        const push = vi.fn();
        const seen = {};
        const detach = attachTelemetryLog(torrent, push, seen);

        torrent.emit('trackerAnnounce');
        torrent.emit('peer', 'peer-id-1');
        const wire = new EventEmitter();
        wire.type = 'webrtc';
        torrent.emit('wire', wire, '198.51.100.4:1234');
        wire.emit('extended', 'handshake', { v: 'WebTorrent', m: { ut_metadata: 1 } });
        torrent.emit('metadata');
        torrent.emit('verified', 0);
        torrent.emit('done');

        expect(seen).toEqual({ announced: true, peerOffered: true });
        const texts = push.mock.calls.map(c => c[0].text);
        expect(texts.some(t => t.startsWith('tracker ack'))).toBe(true);
        expect(texts.some(t => t.includes('wire up [webrtc] 198.51.100.4:1234'))).toBe(true);
        expect(texts.some(t => t.includes('BEP 10 handshake: WebTorrent · ext ut_metadata'))).toBe(true);
        expect(texts.some(t => t.includes('2 × 16.0 KiB pieces'))).toBe(true);
        expect(texts.some(t => t.includes('piece #0 SHA-1 ✓ (1/2)'))).toBe(true);

        detach();
        expect(torrent.listenerCount('metadata')).toBe(0);
        expect(torrent.listenerCount('verified')).toBe(0);
    });
});
