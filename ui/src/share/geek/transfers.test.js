import { describe, it, expect } from 'vitest';
import { readTransfers, describeSplit, serverSteps, linkKind, totals, formatDuration, formatSpan, readServerCopies } from './transfers';

const chain = ip => [
    { type: 'host', typeDetail: 'host', ip: '192.168.1.' + ip.split('.').pop() },
    { type: 'srflx', typeDetail: 'srflx', ip, port: 5000 },
];

const ledgerItem = (extra = {}) => ({
    infoHash: 'abc', name: 'beach.jpg', startedAt: 1000, stages: [{ at: 1000, lane: 'p2p', stage: 'signal', text: 'announce' }],
    peers: new Map(), server: { rx: 0, tx: 0 }, serverStage: null, ...extra,
});

const room = {
    myPeerId: 'me',
    peers: [
        { peerId: 'me', networkChain: chain('84.1.1.1') },
        { peerId: 'ana', name: 'Ana', networkChain: chain('84.1.1.1') },
        { peerId: 'bo', name: 'Bo', networkChain: chain('91.2.2.2') },
    ],
    connections: [
        { fromPeerId: 'me', toPeerId: 'ana', connectionType: 'p2p' },
        { fromPeerId: 'bo', toPeerId: 'me', connectionType: 'relay udp' },
    ],
};

describe('readTransfers', () => {
    it('splits a download by where its bytes came from, by the path each peer took', () => {
        const [row] = readTransfers({
            ...room,
            items: [ledgerItem({ peers: new Map([['ana', { rx: 3000, tx: 0 }], ['bo', { rx: 1000, tx: 0 }]]) })],
            photos: [{ infoHash: 'abc', peerId: 'ana', fileName: 'beach.jpg' }],
            torrents: [{ infoHash: 'abc', progress: 1, done: true, length: 4000, pieces: [1], wires: [] }],
            hasTurn: true,
        });
        expect(row.direction).toBe('down');
        expect(row.sources.map(source => [source.label, source.kind, source.bytes])).toEqual([['Ana', 'lan', 3000], ['Bo', 'relay', 1000]]);
        expect(row.split).toEqual({ total: 4000, server: 0, relay: 1000, p2p: 3000 });
        expect(row.decentral.text).toBe('peer-to-peer · 25% through TURN');
        expect(row.why[0]).toMatch(/Ana is on your network/);
        expect(row.why[1]).toMatch(/Data with Bo goes through the TURN relay/);
        expect(row.p2p.every(step => step.state === 'done')).toBe(true);
    });

    it('says the server carried what P2P could not, and why', () => {
        const [row] = readTransfers({
            ...room,
            items: [ledgerItem({
                peers: new Map([['bo', { rx: 1000, tx: 0 }]]),
                server: { rx: 3000, tx: 0 },
                serverStage: { direction: 'down', stage: 'done', why: 'no P2P progress for 10 s', loaded: 3000, total: 3000 },
            })],
            photos: [{ infoHash: 'abc', peerId: 'bo', fromServerCopy: true }],
            torrents: [],
        });
        expect(row.done).toBe(true);
        expect(row.viaServer).toBe(true);
        expect(row.sources.at(-1)).toMatchObject({ label: 'server', kind: 'server', bytes: 3000, how: 'HTTPS server copy' });
        expect(row.decentral.text).toBe('25% P2P · 75% server');
        expect(row.why[0]).toBe('Downloaded from the server over HTTPS because no P2P progress for 10 s.');
        expect(row.serverSteps.map(step => step.state)).toEqual(['done', 'done', 'done', 'done']);
    });

    it('explains a stuck download whose holders are all in another app', () => {
        const [row] = readTransfers({
            ...room,
            peers: [...room.peers.slice(0, 2), { ...room.peers[2], away: true }],
            items: [ledgerItem()],
            photos: [{ infoHash: 'abc', peerId: 'bo', owners: [{ peerId: 'bo', loading: false }] }],
            torrents: [{ infoHash: 'abc', progress: 0, wires: [], numPeers: 0 }],
        });
        expect(row.done).toBe(false);
        expect(row.phase).toBe('discover');
        expect(row.why).toEqual(['All devices with this photo are in another app. Phones stop P2P in the background.']);
    });

    it('shows a sharer what it sent and why it left a server copy', () => {
        const [row] = readTransfers({
            ...room,
            items: [ledgerItem({
                peers: new Map([['ana', { rx: 0, tx: 2000 }]]),
                serverStage: { direction: 'up', stage: 'uploading', loaded: 1000, total: 2000, why: 'the room keeps server copies for latecomers' },
            })],
            photos: [{ infoHash: 'abc', peerId: 'me' }],
            torrents: [{ infoHash: 'abc', progress: 1, done: true, wires: [] }],
        });
        expect(row.direction).toBe('up');
        expect(row.sources).toHaveLength(1);
        expect(row.why[0]).toBe('Uploading a server copy because the room keeps server copies for latecomers.');
        expect(row.serverSteps.map(step => step.state)).toEqual(['done', 'active', 'todo']);
    });

    it('lists the most recently active transfer first', () => {
        const rows = readTransfers({
            ...room,
            items: [
                ledgerItem({ infoHash: 'old', stages: [{ at: 10, lane: 'p2p', stage: 'signal' }] }),
                ledgerItem({ infoHash: 'new', stages: [{ at: 20, lane: 'p2p', stage: 'signal' }] }),
            ],
        });
        expect(rows.map(row => row.infoHash)).toEqual(['new', 'old']);
    });
});

describe('timings', () => {
    it('says how long a finished transfer took, and how long each stage ran', () => {
        const [row] = readTransfers({
            ...room,
            items: [ledgerItem({
                peers: new Map([['ana', { rx: 4000, tx: 0 }]]),
                stages: [
                    { at: 1000, lane: 'p2p', stage: 'signal', text: 'announce' },
                    { at: 3000, lane: 'p2p', stage: 'handshake', text: 'wire up' },
                    { at: 9000, lane: 'p2p', stage: 'verify', text: 'verified' },
                ],
            })],
            photos: [{ infoHash: 'abc', peerId: 'ana', fileName: 'beach.jpg', fileSize: 4000 }],
            torrents: [{ infoHash: 'abc', progress: 1, done: true, length: 4000, pieces: [1], wires: [] }],
        });
        // 1 s to announce, 6 s to the last stage, and nothing after it.
        expect(row.elapsedMs).toBe(8000);
        expect(row.runningMs).toBe(null);
        expect(row.stages.map(stage => stage.tookMs)).toEqual([2000, 6000, null]);
    });

    it('counts up while a transfer is still going, with no end to measure', () => {
        const [row] = readTransfers({
            ...room,
            now: 11000,
            items: [ledgerItem({ stages: [{ at: 1000, lane: 'p2p', stage: 'signal', text: 'announce' }] })],
            photos: [{ infoHash: 'abc', peerId: 'ana', fileName: 'beach.jpg' }],
            torrents: [{ infoHash: 'abc', progress: 0.2, done: false, length: 4000, pieces: [1], wires: [] }],
        });
        expect(row.done).toBe(false);
        expect(row.elapsedMs).toBe(null);
        expect(row.runningMs).toBe(10000);
    });

    it('uses the last update of a stage that rewrote itself', () => {
        const [row] = readTransfers({
            ...room,
            items: [ledgerItem({
                stages: [
                    { at: 1000, until: 4000, lane: 'server', stage: 'uploading', text: 'PUT' },
                    { at: 4000, lane: 'server', stage: 'stored', text: 'stored' },
                ],
                serverStage: { direction: 'up', stage: 'stored' },
                server: { rx: 0, tx: 4000 },
            })],
            photos: [{ infoHash: 'abc', peerId: 'me', fileName: 'beach.jpg' }],
        });
        expect(row.direction).toBe('up');
        expect(row.stages[0].tookMs).toBe(3000);
    });

    it('formats a duration to read at a glance in a narrow row', () => {
        expect(formatDuration(420)).toBe('420 ms');
        expect(formatDuration(4200)).toBe('4.2 s');
        expect(formatDuration(45800)).toBe('46 s');
        expect(formatDuration(125000)).toBe('2 m 05 s');
        expect(formatDuration(null)).toBe('');
    });
});

describe('helpers', () => {
    it('names the path a connection type stands for', () => {
        expect(linkKind('p2p')).toBe('lan');
        expect(linkKind('relay tcp')).toBe('relay');
        expect(linkKind('stun')).toBe('punch');
        expect(linkKind('')).toBe('unknown');
    });

    it('describes how decentralized the bytes were', () => {
        expect(describeSplit({ total: 0 }).level).toBe('none');
        expect(describeSplit({ total: 10, server: 0, relay: 0, p2p: 10 }).text).toBe('fully peer-to-peer');
        expect(describeSplit({ total: 10, server: 10, relay: 0, p2p: 0 }).text).toBe('all through the server');
        expect(totals([{ split: { total: 1, p2p: 1, relay: 0, server: 0 } }, { split: { total: 2, p2p: 0, relay: 0, server: 2 } }]))
            .toEqual({ total: 3, p2p: 1, relay: 0, server: 2 });
    });

    it('marks a refused upload as failed where it stopped', () => {
        expect(serverSteps('up', { stage: 'too-large' }).map(step => step.state)).toEqual(['done', 'failed', 'todo']);
        expect(serverSteps('down', { stage: 'requested' }, { hasServerCopy: false }).map(step => step.state)).toEqual(['done', 'active', 'todo', 'todo']);
    });
});

describe('readServerCopies', () => {
    const H = 60 * 60 * 1000;
    const peers = [{ peerId: 'me', name: 'Mine' }, { peerId: 'ana', name: 'Ana' }, { peerId: 'bo', name: 'Bo' }];
    const stored = {
        infoHash: 'h1', fileName: 'beach.jpg', hasServerCopy: true, serverCopySize: 2000,
        serverCopyFrom: 'ana', serverCopyStartedAt: 1000, serverCopyStoredAt: 5000, serverCopyExpiresAt: 5000 + 24 * H,
        owners: [{ peerId: 'ana' }, { peerId: 'me' }],
    };

    it('lists every copy in the room with who sent it, how far it got and when it goes', () => {
        const rows = readServerCopies({
            myPeerId: 'me', peers, now: 5000 + 2 * H,
            photos: [
                stored,
                { infoHash: 'h2', fileName: 'clip.mp4', serverCopySize: 1000, serverCopyReceived: 250, serverCopyUploader: 'me', serverCopyFrom: 'me', owners: [] },
                { infoHash: 'h3', fileName: 'asked.jpg', serverCopyRequestedAt: 4000, owners: [] },
                { infoHash: 'h4', fileName: 'p2p-only.jpg', owners: [] },
            ],
        });
        expect(rows.map(row => [row.name, row.state, row.percent, row.from])).toEqual([
            ['beach.jpg', 'stored', 100, 'Ana'],
            ['clip.mp4', 'uploading', 25, 'you'],
            ['asked.jpg', 'requested', 0, null],
        ]);
        expect(rows[0].goes).toBe('deleted when the last person gets it, or in 22 h 00 m at most');
    });

    it('says a room that keeps copies holds them until they expire', () => {
        const [row] = readServerCopies({ myPeerId: 'me', peers, keepCopies: true, now: 5000 + 23.5 * H, photos: [stored] });
        expect(row.goes).toBe('kept for latecomers, deleted in 30 m');
    });

    it('reads coarse spans', () => {
        expect(formatSpan(40 * 1000)).toBe('40 s');
        expect(formatSpan(12 * 60 * 1000)).toBe('12 m');
        expect(formatSpan(23 * H + 5 * 60 * 1000)).toBe('23 h 05 m');
    });
});
