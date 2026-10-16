import { describe, it, expect } from 'vitest';
import { buildAnnounceList, withFallbackIceServers, hasTurnServer, PUBLIC_WS_TRACKERS } from '../DiscoveryConfig';

describe('buildAnnounceList', () => {
    it('puts the own tracker first and appends public trackers', () => {
        const list = buildAnnounceList('wss://example.test/ws');
        expect(list[0]).toBe('wss://example.test/ws');
        expect(list).toContain('wss://tracker.openwebtorrent.com');
        expect(list.length).toBe(1 + PUBLIC_WS_TRACKERS.length);
    });
    it('dedupes and drops non-websocket urls', () => {
        const list = buildAnnounceList('wss://tracker.openwebtorrent.com', ['https://x.test', 'wss://tracker.openwebtorrent.com', null]);
        expect(list).toEqual(['wss://tracker.openwebtorrent.com']);
    });
    it('still returns public trackers when own tracker is missing', () => {
        expect(buildAnnounceList(null).length).toBeGreaterThan(0);
    });
});

describe('withFallbackIceServers', () => {
    it('supplies STUN servers when config is empty/missing', () => {
        expect(withFallbackIceServers(null).iceServers.length).toBeGreaterThan(2);
        expect(withFallbackIceServers({ iceServers: [] }).iceServers.length).toBeGreaterThan(2);
    });
    it('preserves TURN and does not duplicate STUN', () => {
        const turn = { urls: 'turn:turn.example:3478', username: 'u', credential: 'c' };
        const result = withFallbackIceServers({ iceServers: [{ urls: 'stun:stun.l.google.com:19302' }, turn] });
        expect(result.iceServers).toContainEqual(turn);
        expect(result.iceServers.filter(s => s.urls === 'stun:stun.l.google.com:19302')).toHaveLength(1);
        expect(hasTurnServer(result)).toBe(true);
    });
});
