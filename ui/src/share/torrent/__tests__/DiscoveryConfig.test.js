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
        expect(withFallbackIceServers({ iceTransportPolicy: 'all' })).toMatchObject({ iceTransportPolicy: 'all' });
    });
    it('preserves a custom STUN list without appending fallbacks', () => {
        const iceServers = [{ urls: 'stun:custom.example:3478' }];
        expect(withFallbackIceServers({ iceServers }).iceServers).toBe(iceServers);
    });
    it('preserves a populated configuration unchanged', () => {
        const turn = { urls: 'turn:turn.example:3478', username: 'u', credential: 'c' };
        const config = Object.freeze({ iceTransportPolicy: 'relay', iceServers: Object.freeze([turn]) });
        const result = withFallbackIceServers(config);
        expect(result).toBe(config);
        expect(result.iceServers).toEqual([turn]);
        expect(result.iceServers).toContainEqual(turn);
        expect(hasTurnServer(result)).toBe(true);
    });
});
