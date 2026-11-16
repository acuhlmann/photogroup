import React from 'react';
import { describe, it, expect } from 'vitest';
import { createRoot } from 'react-dom/client';
import { act } from 'react';
import { deviceTimesLine, readSummary } from './sessionSummary';
import SessionSummary from './SessionSummary';

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
        expect(summary.parts.map(part => part.label)).toEqual(['P2P direct', 'TURN relay', 'server copy']);
        expect(summary.devices).toEqual([{ peerId: 'ana', name: 'Ana', line: 'first photo 1.0 s · all 2 in 5.0 s', done: true }]);
        expect(summary.key).toBe(9);
    });

    it('surfaces STUN, TURN vs server-copy fallback, and primary vs public tracker context', () => {
        const rows = [{ split: { total: 2000, p2p: 2000, relay: 0, server: 0 } }];
        const noTurn = readSummary({
            rows,
            rtcConfig: { iceServers: [{ urls: 'stun:stun.l.google.com:19302' }] },
            trackerUrl: 'wss://photogroup.network/ws',
            announceUrls: ['wss://photogroup.network/ws', 'wss://tracker.openwebtorrent.com'],
        });
        expect(noTurn.network).toMatchObject({
            hasStun: true,
            hasTurn: false,
            stunLabel: 'STUN discovery',
            turnLabel: 'no TURN · HTTPS server copy fallback',
            primaryTracker: 'photogroup.network',
            publicTrackers: 1,
        });

        const withTurn = readSummary({
            rows,
            rtcConfig: {
                iceServers: [
                    { urls: 'stun:stun.l.google.com:19302' },
                    { urls: 'turn:turn.example.com:3478', username: 'u', credential: 'c' },
                ],
            },
            trackerUrl: 'wss://photogroup.network/ws',
            announceUrls: ['wss://photogroup.network/ws'],
        });
        expect(withTurn.network).toMatchObject({
            hasStun: true,
            hasTurn: true,
            turnLabel: 'TURN media relay ready',
            publicTrackers: 0,
        });
    });
});

describe('SessionSummary component', () => {
    it('renders the transport split and STUN/TURN/tracker context line', async () => {
        const summary = readSummary({
            rows: [{ split: { total: 4000, p2p: 3000, relay: 1000, server: 0 } }],
            share: { done: true, devices: 2, photos: 1, totalMs: 5000, endedAt: 1 },
            rtcConfig: {
                iceServers: [
                    { urls: 'stun:stun.l.google.com:19302' },
                    { urls: 'turn:turn.example.com:3478', username: 'u', credential: 'c' },
                ],
            },
            trackerUrl: 'wss://photogroup.network/ws',
            announceUrls: ['wss://photogroup.network/ws', 'wss://tracker.openwebtorrent.com', 'wss://tracker.btorrent.xyz'],
        });
        const div = document.createElement('div');
        document.body.appendChild(div);
        const root = createRoot(div);
        await act(async () => root.render(<SessionSummary summary={summary} onClose={() => {}} />));
        const net = div.querySelector('[data-testid="summary-network-line"]');
        expect(net.textContent).toContain('STUN discovery');
        expect(net.textContent).toContain('TURN media relay ready');
        expect(net.textContent).toContain('PG tracker + 2 public WS');
        expect(div.textContent).toContain('P2P direct 75%');
        expect(div.textContent).toContain('TURN relay 25%');
        await act(async () => root.unmount());
        div.remove();
    });
});
