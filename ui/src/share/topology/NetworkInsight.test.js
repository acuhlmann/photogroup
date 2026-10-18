import { describe, it, expect } from 'vitest';
import {
    describeIceServers, forecastPath, isCgnat, isMdns, summarizeChain, verdictFor,
} from './NetworkInsight';

const host = (ip, port = 5000) => ({ ip, port, transport: 'udp', type: 'host', typeDetail: 'host' });
const srflx = (ip, port, nat = 'Normal NAT') => ({ ip, port, transport: 'udp', type: 'srflx', typeDetail: nat + ' srflx' });

describe('NetworkInsight', () => {
    it('recognises mDNS and CGNAT addresses', () => {
        expect(isMdns('3f2a-11.local')).toBe(true);
        expect(isMdns('192.168.1.4')).toBe(false);
        expect(isCgnat('100.72.3.1')).toBe(true);
        expect(isCgnat('100.200.3.1')).toBe(false);
    });

    it('summarises a chain', () => {
        const s = summarizeChain([
            host('abcd.local'), host('100.70.1.2'),
            { ...srflx('203.0.113.9', 41000), network: { city: 'Vienna', country_code: 'AT', connection: { isp: 'A1' } } },
            srflx('203.0.113.9', 41000),
        ]);
        expect(s).toMatchObject({
            gathered: true, hostCount: 2, mdnsCount: 1, lanIps: ['100.70.1.2'], cgnat: true,
            publicIps: ['203.0.113.9'], nat: 'cone', relay: false, transports: ['udp'],
        });
        expect(s.reflexive).toEqual([{ ip: '203.0.113.9', port: 41000, place: 'Vienna, AT · A1' }]);
        expect(summarizeChain([srflx('1.2.3.4', 1)]).nat).toBe('cone?');
        expect(summarizeChain([srflx('1.2.3.4', 1, 'Symmetric NAT')]).nat).toBe('symmetric');
        expect(summarizeChain(null)).toMatchObject({ gathered: false, nat: 'unknown' });
    });

    it('lists ICE server hosts without credentials', () => {
        expect(describeIceServers({ iceServers: [
            { urls: 'stun:stun.l.google.com:19302' },
            { urls: ['turn:global.turn.example.com:3478?transport=udp', 'turns:global.turn.example.com:443'], username: 'u', credential: 'secret' },
        ] })).toEqual({ stun: ['stun.l.google.com'], turn: ['global.turn.example.com'] });
        expect(describeIceServers(undefined)).toEqual({ stun: [], turn: [] });
    });

    it('forecasts the path between two peers', () => {
        const a = summarizeChain([host('a.local'), srflx('198.51.100.1', 1), srflx('198.51.100.1', 1)]);
        const sameNat = summarizeChain([host('b.local'), srflx('198.51.100.1', 2)]);
        const otherCone = summarizeChain([host('c.local'), srflx('203.0.113.5', 3), srflx('203.0.113.5', 3)]);
        const sym = summarizeChain([srflx('192.0.2.7', 4, 'Symmetric NAT')]);
        const sym2 = summarizeChain([srflx('192.0.2.8', 5, 'Symmetric NAT')]);
        const noStun = summarizeChain([host('d.local')]);

        expect(forecastPath(a, sameNat)).toMatchObject({ path: 'lan', level: 'good' });
        expect(forecastPath(a, otherCone)).toMatchObject({ path: 'stun', level: 'good' });
        expect(forecastPath(a, sym)).toMatchObject({ path: 'stun', level: 'ok' });
        expect(forecastPath(sym, sym2)).toMatchObject({ path: 'server', level: 'poor' });
        expect(forecastPath(sym, sym2, { hasTurn: true })).toMatchObject({ path: 'relay' });
        expect(forecastPath(a, noStun)).toMatchObject({ level: 'poor' });
        expect(forecastPath(a, summarizeChain([]))).toMatchObject({ level: 'unknown' });
    });

    it('gives an overall verdict', () => {
        expect(verdictFor(summarizeChain([])).level).toBe('unknown');
        expect(verdictFor(summarizeChain([host('a.local')])).level).toBe('poor');
        expect(verdictFor(summarizeChain([srflx('1.1.1.1', 1, 'Symmetric NAT')]), { hasTurn: true }).text).toMatch(/TURN/);
        expect(verdictFor(summarizeChain([srflx('1.1.1.1', 1)])).level).toBe('good');
    });
});

describe('verdictFor while STUN is pending', () => {
    it('does not call STUN failed before gathering ends', () => {
        const hostOnly = summarizeChain([host('a.local')]);
        expect(verdictFor(hostOnly, { stunPending: true }).level).toBe('unknown');
        expect(verdictFor(hostOnly, { stunPending: false }).level).toBe('poor');
    });
});
