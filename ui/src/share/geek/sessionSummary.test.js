import { describe, it, expect } from 'vitest';
import { deviceTimesLine, readSummary } from './sessionSummary';

describe('deviceTimesLine', () => {
    it('says how long a device took, or how far it has come', () => {
        expect(deviceTimesLine({ wanted: 3, got: 3, firstMs: 2100, allMs: 14000 })).toBe('first photo 2.1 s · all 3 in 14 s');
        expect(deviceTimesLine({ wanted: 3, got: 1, firstMs: 2100, allMs: null, waitingMs: 20000 })).toBe('first photo 2.1 s · 1 of 3 · 20 s so far');
        expect(deviceTimesLine({ wanted: 2, got: 2, firstMs: null, allMs: null, before: true })).toBe('had all 2 before you came');
        expect(deviceTimesLine({ wanted: 0 })).toBe(null);
    });
});

describe('readSummary', () => {
    it('sums up a finished share: photos, devices, time, the split and each device', () => {
        const rows = [{ split: { total: 4000, p2p: 3000, relay: 0, server: 1000 } }];
        const summary = readSummary({
            rows,
            share: { done: true, devices: 3, photos: 2, totalMs: 41000, endedAt: 9 },
            devices: [
                { peerId: 'me', wanted: 0 },
                { peerId: 'ana', wanted: 2, got: 2, firstMs: 1000, allMs: 5000 },
            ],
            peers: [{ peerId: 'ana', name: 'Ana' }],
            myPeerId: 'me',
        });
        expect(summary.headline).toBe('2 photos to 2 devices in 41 s');
        expect(summary.parts.map(part => part.percent)).toEqual([75, 0, 25]);
        expect(summary.devices).toEqual([{ peerId: 'ana', name: 'Ana', line: 'first photo 1.0 s · all 2 in 5.0 s', done: true }]);
        expect(summary.key).toBe(9);
    });
});
