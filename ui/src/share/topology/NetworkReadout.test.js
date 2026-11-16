import React from 'react';
import { describe, it, expect } from 'vitest';
import { createRoot } from 'react-dom/client';
import { act } from 'react';
import EventEmitter from 'eventemitter3';
import NetworkReadout from './NetworkReadout';

describe('NetworkReadout', () => {
    it('shows STUN discovery, TURN relay status, and primary vs public backup trackers', async () => {
        const oldAnnounce = window.WEBTORRENT_ANNOUNCE;
        window.WEBTORRENT_ANNOUNCE = [
            'wss://photogroup.network/ws',
            'wss://tracker.openwebtorrent.com',
            'wss://tracker.btorrent.xyz',
        ];
        try {
            const master = {
                emitter: new EventEmitter(),
                client: { peerId: 'me' },
                localNetwork: [
                    { type: 'host', typeDetail: 'host', ip: '192.168.1.2', port: 5000, transport: 'udp' },
                    { type: 'srflx', typeDetail: 'Normal NAT srflx', ip: '203.0.113.5', port: 51000, transport: 'udp' },
                ],
                creator: {
                    trackerWsUrl: 'wss://photogroup.network/ws',
                    iceServers: {
                        iceServers: [
                            { urls: 'stun:stun.l.google.com:19302' },
                            { urls: 'turn:global.turn.twilio.com:3478', username: 'u', credential: 'c' },
                        ],
                    },
                },
                peers: { items: [] },
            };
            const div = document.createElement('div');
            document.body.appendChild(div);
            const root = createRoot(div);
            await act(async () => root.render(<NetworkReadout master={master} />));

            const text = div.textContent;
            expect(text).toContain('stun.l.google.com');
            expect(text).toContain('ICE discovery (IP:port only, no media)');
            expect(text).toContain('global.turn.twilio.com');
            expect(text).toContain('encrypted media relay fallback');
            expect(text).toContain('photogroup.network');
            expect(text).toContain('primary WS (SDP + topology)');
            expect(text).toContain('tracker.openwebtorrent.com, tracker.btorrent.xyz');
            expect(text).toContain('backup WS (no DHT)');

            await act(async () => {
                master.emitter.emit('pcEvent', 'icecandidate', 'srflx 203.0.113.5:51000');
                master.emitter.emit('pcEvent', 'icecandidate', 'relay 192.0.2.8:49152');
            });
            expect(div.textContent).toContain('STUN lookup → srflx 203.0.113.5:51000');
            expect(div.textContent).toContain('TURN allocate → relay 192.0.2.8:49152');

            await act(async () => root.unmount());
            div.remove();
        } finally {
            window.WEBTORRENT_ANNOUNCE = oldAnnounce;
        }
    });

    it('notes HTTPS server copy fallback when no TURN server is configured and refreshes on wtInitialized', async () => {
        const oldAnnounce = window.WEBTORRENT_ANNOUNCE;
        window.WEBTORRENT_ANNOUNCE = ['wss://photogroup.network/ws'];
        try {
            const master = {
                emitter: new EventEmitter(),
                client: { peerId: 'me' },
                localNetwork: [{ type: 'host', ip: '10.0.0.2', port: 5000 }],
                creator: {
                    trackerWsUrl: 'wss://photogroup.network/ws',
                    iceServers: { iceServers: [{ urls: 'stun:stun.cloudflare.com:3478' }] },
                },
                peers: { items: [] },
            };
            const div = document.createElement('div');
            document.body.appendChild(div);
            const root = createRoot(div);
            await act(async () => root.render(<NetworkReadout master={master} />));

            expect(div.textContent).toContain('none · HTTPS server copy is the fallback');
            expect(div.textContent).toContain('none (primary WS only)');

            window.WEBTORRENT_ANNOUNCE = ['wss://photogroup.network/ws', 'wss://tracker.openwebtorrent.com'];
            await act(async () => master.emitter.emit('wtInitialized'));
            expect(div.textContent).toContain('tracker.openwebtorrent.com');
            expect(div.textContent).toContain('backup WS (no DHT)');

            await act(async () => root.unmount());
            div.remove();
        } finally {
            window.WEBTORRENT_ANNOUNCE = oldAnnounce;
        }
    });
});
