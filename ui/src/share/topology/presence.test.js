import { describe, it, expect } from 'vitest';
import { isAway, holdersOf, activeHolders, peerLabel } from './presence';

describe('presence', () => {
    const peers = [
        { peerId: 'me', name: 'Me' },
        { peerId: 'alex', name: 'Alex', away: 1700000000000 },
        { peerId: 'sam', originPlatform: 'Pixel 7' },
        { peerId: 'kim', name: 'Kim' },
    ];
    const photo = {
        owners: [
            { peerId: 'me', loading: false },
            { peerId: 'alex', loading: false },
            { peerId: 'sam', loading: false },
            { peerId: 'kim', loading: true },
            { peerId: 'gone', loading: false },
        ],
    };

    it('lists other members holding the whole photo, away or not', () => {
        expect(holdersOf(photo, peers, 'me').map(p => p.peerId)).toEqual(['alex', 'sam']);
        expect(holdersOf(photo, { items: peers }, 'me').map(p => p.peerId)).toEqual(['alex', 'sam']);
    });

    it('leaves out holders whose app is in the background', () => {
        expect(activeHolders(photo, peers, 'me').map(p => p.peerId)).toEqual(['sam']);
        expect(isAway(peers[1])).toBe(true);
        expect(isAway(peers[2])).toBe(false);
    });

    it('names a peer by nickname, then device', () => {
        expect(peerLabel(peers[1])).toBe('Alex');
        expect(peerLabel(peers[2])).toBe('Pixel 7');
        expect(peerLabel(undefined)).toBe('someone');
    });
});
