import { describe, it, expect } from 'vitest';
import { serverCopyStatus } from './serverCopyStatus';

const peers = [
    { peerId: 'me', name: 'Me' },
    { peerId: 'alex', name: 'Alex', away: 1 },
    { peerId: 'sam', name: 'Sam' },
];
const tile = (fields = {}) => ({ infoHash: 'a', owners: [{ peerId: 'alex', loading: false }], ...fields });

describe('serverCopyStatus', () => {
    it('says nothing while someone who has it is in front, or once received', () => {
        expect(serverCopyStatus(tile({ owners: [{ peerId: 'sam', loading: false }] }), peers, 'me')).toBeNull();
        expect(serverCopyStatus(tile({ fromServerCopy: true, hasServerCopy: true }), peers, 'me')).toBeNull();
        expect(serverCopyStatus(tile({ peerId: 'me', hasServerCopy: true }), peers, 'me')).toBeNull();
        expect(serverCopyStatus(tile({ seed: true, hasServerCopy: true }), peers, 'me')).toBeNull();
    });

    it('explains who the photo waits for, and offers to ask for a copy', () => {
        expect(serverCopyStatus(tile(), peers, 'me')).toEqual({
            text: 'Waiting for Alex to come back', canFetch: false, canAsk: true, holdersAway: true
        });
        expect(serverCopyStatus(tile({ serverCopyRequestedAt: 1 }), peers, 'me').text).toBe('Asked for a server copy · Alex is away');
    });

    it('shows a copy on its way, then ready', () => {
        expect(serverCopyStatus(tile({ serverCopyUploader: 'alex', serverCopySize: 200, serverCopyReceived: 50 }), peers, 'me').text)
            .toBe('Alex is leaving a server copy · 25%');
        expect(serverCopyStatus(tile({ hasServerCopy: true }), peers, 'me')).toMatchObject({ canFetch: true, canAsk: false });
    });
});
