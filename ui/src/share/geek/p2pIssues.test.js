import { describe, it, expect } from 'vitest';
import { p2pIssues, wantedPeers, wiredPeers, NO_LINK_MS } from './p2pIssues';

const lan = ip => [{ type: 'host', ip: '192.168.1.' + ip }, { type: 'srflx', ip: '84.1.1.1', port: 5000 }];
const peers = [
    { peerId: 'me', networkChain: lan(2) },
    { peerId: 'ana', name: 'Ana', networkChain: lan(3) },
    { peerId: 'bo', name: 'Bo', networkChain: [] },
];
const item = (extra = {}) => ({ infoHash: 'abc', startedAt: 0, stages: [], failures: [], serverStage: null, ...extra });

describe('p2pIssues', () => {
    it('says when this browser may only use TURN, and TURN gave no address', () => {
        const issues = p2pIssues({ myPeerId: 'me', peers, rtcConfig: { iceTransportPolicy: 'relay' } });
        expect(issues.get('me')).toEqual({
            short: 'relay only · no TURN address',
            why: ['This browser may connect only through TURN. TURN gave no address, so no WebRTC connection can start.'],
        });
    });

    it('counts the WebRTC connections that failed', () => {
        const items = [item({ failures: [{ at: 1, reason: 'ICE failed' }, { at: 2, reason: 'ICE failed' }] })];
        expect(p2pIssues({ myPeerId: 'me', peers, items }).get('me').short).toBe('ICE failed ×2');
    });

    it('marks a device whose photo came as a server copy, and one still without a link', () => {
        const photos = [
            { infoHash: 'abc', peerId: 'ana', owners: [{ peerId: 'ana' }] },
            { infoHash: 'def', peerId: 'bo', owners: [{ peerId: 'bo' }] },
        ];
        const items = [
            item({ serverStage: { direction: 'down', stage: 'done' } }),
            item({ infoHash: 'def' }),
        ];
        const issues = p2pIssues({ myPeerId: 'me', peers, photos, items, now: NO_LINK_MS + 2000 });
        expect(issues.get('ana').short).toBe('no P2P · server copy');
        expect(issues.get('bo').short).toBe('no link after 17 s');
        // A wire up: nothing to say.
        expect(p2pIssues({ myPeerId: 'me', peers, photos, items: [item({ infoHash: 'def' })], wired: new Set(['bo']), now: 99999 }).has('bo')).toBe(false);
    });

    it('says a device in another app cannot send', () => {
        const away = [...peers.slice(0, 2), { ...peers[2], away: true }];
        expect(p2pIssues({ myPeerId: 'me', peers: away }).get('bo').short).toBe('in another app');
    });
});

describe('wantedPeers and wiredPeers', () => {
    it('lists who a photo still has to cross a link with', () => {
        const photos = [
            { infoHash: 'a', peerId: 'me', owners: [{ peerId: 'me' }, { peerId: 'ana', loading: true }] },
            { infoHash: 'b', peerId: 'bo', owners: [{ peerId: 'bo' }, { peerId: 'me', loading: true }] },
            { infoHash: 'c', peerId: 'cy', owners: [{ peerId: 'cy' }, { peerId: 'dee', loading: true }] },
        ];
        expect([...wantedPeers({ photos, myPeerId: 'me' })].sort()).toEqual(['ana', 'bo']);
        expect([...wiredPeers([{ wires: [{ peerId: 'ana' }] }, { wires: [] }, null])]).toEqual(['ana']);
    });
});

describe('p2pIssues from the sharer side', () => {
    it('marks a device without a link that lacks a photo the room asked a server copy of', () => {
        const photos = [{ infoHash: 'abc', peerId: 'me', owners: [{ peerId: 'me' }, { peerId: 'ana' }], serverCopyRequestedAt: 5 }];
        const issues = p2pIssues({ myPeerId: 'me', peers, photos, items: [item()], wired: new Set(['ana']), now: 1000 });
        expect(issues.get('bo').short).toBe('no P2P · server copy');
        expect(issues.has('ana')).toBe(false);
    });
});
