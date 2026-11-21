import { describe, it, expect } from 'vitest';
import { arrivingText } from './arrivingText';

const tile = (over = {}) => ({ infoHash: 'abc', loading: true, owners: [{ peerId: 'alex', loading: false }], ...over });
const alex = { peerId: 'alex', name: 'Alex' };

describe('arrivingText', () => {
    it('gives the percent once bytes come', () => {
        expect(arrivingText(tile({ torrentFile: { progress: 0.123 } }), { peers: [alex] })).toBe('Arriving · 12%');
    });

    it('says arriving when a connection is open but no byte is here yet', () => {
        expect(arrivingText(tile(), { torrent: { wires: [{}] }, peers: [alex] })).toBe('Arriving…');
    });

    it('names the person it connects to', () => {
        expect(arrivingText(tile(), { torrent: { wires: [] }, peers: [alex], myPeerId: 'me' })).toBe('Connecting to Alex…');
    });

    it('counts the phones when more than one has the photo', () => {
        const owners = [{ peerId: 'alex', loading: false }, { peerId: 'kim', loading: false }];
        expect(arrivingText(tile({ owners }), { peers: [alex, { peerId: 'kim' }] })).toBe('Connecting to 2 phones…');
        expect(arrivingText(tile({ owners }), { peers: [alex, { peerId: 'kim' }], device: 'device' })).toBe('Connecting to 2 devices…');
    });

    it('says a phone when the person has no name', () => {
        expect(arrivingText(tile(), { peers: [{ peerId: 'alex' }] })).toBe('Connecting to a phone…');
    });

    it('waits when the phone with the photo is away', () => {
        expect(arrivingText(tile(), { peers: [{ ...alex, away: true }] })).toBe('Waiting for the phone with this photo');
    });

    it('does not count this phone or a phone that still gets the photo', () => {
        const owners = [{ peerId: 'me', loading: false }, { peerId: 'kim', loading: true }];
        expect(arrivingText(tile({ owners }), { peers: [{ peerId: 'me' }, { peerId: 'kim' }], myPeerId: 'me' })).toBe('Arriving…');
    });
});
