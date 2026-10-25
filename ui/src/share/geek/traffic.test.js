import { describe, it, expect, vi } from 'vitest';
import EventEmitter from 'eventemitter3';
import { attachTraffic, flowAt, FLOW_MS } from './traffic';
import { createTimeline } from './timeline';

// The scene the map builds: our device, one other peer, and the routes traffic
// can take between them.
const scene = () => ({
    routes: [
        { id: 'sse:me', kind: 'sse', path: ['me', 'edge', 'api'], peerId: 'me' },
        { id: 'sse:them', kind: 'sse', path: ['them', 'edge', 'api'], peerId: 'them' },
        { id: 'tracker:me', kind: 'tracker', path: ['me', 'edge', 'tracker'], peerId: 'me' },
        { id: 'copies:me', kind: 'copies', path: ['me', 'edge', 'copies'], peerId: 'me' },
        { id: 'stun:nat:1', kind: 'stun', path: ['nat:1', 'stun'] },
        { id: 'p2p:me|them', kind: 'lan', path: ['me', 'them'], peers: ['me', 'them'] },
    ],
});

/** A room wired the way the stage wires it: one emitter, one timeline, one clock. */
const setup = ({ animate = () => true, start = 1000 } = {}) => {
    const emitter = new EventEmitter();
    const clock = { value: start };
    const now = () => clock.value;
    const timeline = createTimeline({ now });
    const stop = attachTraffic({
        timeline, emitter, getScene: scene, getMyId: () => 'me', animate, now,
    });
    return { emitter, timeline, clock, stop };
};

const torrent = { name: 'beach.jpg', infoHash: 'abc', pieces: new Array(4).fill(0), pieceLength: 1024 };

describe('attachTraffic', () => {
    it('records one entry that is both a log line and the packets that flew', () => {
        const { emitter, timeline } = setup();
        emitter.emit('peers', { type: 'add', item: { name: 'Ana', peerId: 'them' } });

        const entry = timeline.recent()[0];
        expect(entry.text).toContain('Ana joined');
        expect(entry.kind).toBe('peer');
    });

    it('sends one SSE packet down every device route per real stream message', () => {
        const { emitter, timeline } = setup();
        emitter.emit('sse', { channel: 'photos', type: 'add', bytes: 412 });

        const entry = timeline.entries[timeline.entries.length - 1];
        expect(entry.kind).toBe('sse');
        expect(entry.bytes).toBe(412);
        // The server sends it to everyone; ours is named, with its size.
        expect(entry.flights.map(f => f.routeId)).toEqual(['sse:me', 'sse:them']);
        expect(entry.flights[0].label).toBe('SSE photos:add 412 B');
        expect(entry.flights[1].label).toBe('');
        expect(entry.flights.every(f => f.reverse)).toBe(true);
    });

    it('draws no SSE packet for a room change made on this device', () => {
        const { emitter, timeline } = setup();
        emitter.emit('photos', { type: 'add', item: [{ fileName: 'beach.jpg', peerId: 'them' }] });
        expect(timeline.recent()[0].text).toContain('beach.jpg');
        expect(timeline.entries.at(-1).flights).toEqual([]);
        // A detail changing here is not traffic at all.
        emitter.emit('photos', { type: 'update', item: [{ fileName: 'beach.jpg' }] });
        expect(timeline.entries).toHaveLength(1);
    });

    it('names our own upload as a magnet POST on the way out', () => {
        const { emitter, timeline } = setup();
        emitter.emit('photos', { type: 'add', item: [{ fileName: 'beach.jpg', peerId: 'me', isFake: true }] });
        const flights = timeline.entries[timeline.entries.length - 1].flights;
        expect(flights.some(f => f.label === 'POST magnet' && !f.reverse)).toBe(true);
    });

    it('counts every piece on its route and dots only some of them', () => {
        const { emitter, timeline } = setup();
        for (let index = 0; index < 4; index++) {
            emitter.emit('pieceReceived', { torrent, index, total: 4, size: 1024, peerId: 'them' });
        }
        const pieces = timeline.entries.filter(entry => entry.count);
        expect(pieces).toHaveLength(4);
        // Each knows its bytes, for the wire meter.
        expect(pieces.every(entry => entry.bytes === 1024)).toBe(true);
        expect(pieces.every(entry => entry.route === 'p2p:me|them')).toBe(true);
        // The last piece always earns its dot, and is named.
        const last = pieces[pieces.length - 1];
        expect(last.flights).toHaveLength(1);
        expect(last.flights[0].label).toBe('#4/4 1.02 kB');
        expect(flowAt(timeline.entries, 'p2p:me|them', last.at).rx).toBe(4);
    });

    it('puts a piece on the route to the peer whose wire carried it', () => {
        const { emitter, timeline } = setup();
        emitter.emit('pieceSent', { torrent, index: 0, total: 4, size: 1024, peerId: 'nobody' });
        // No route to an unknown peer: nothing is recorded.
        expect(timeline.entries.filter(entry => entry.count)).toHaveLength(0);
    });

    it('reports the speed of a torrent on the routes wired for it', () => {
        const { emitter, timeline } = setup();
        const wired = { ...torrent, wires: [{ peerId: 'them' }] };
        emitter.emit('downloadProgress', { torrent: wired, speed: '1 MB/s', progress: 40 });

        const entry = timeline.entries[timeline.entries.length - 1];
        expect(entry.route).toBe('p2p:me|them');
        expect(entry.speed).toBe('1 MB/s');
        expect(entry.text).toContain('1 MB/s ← beach.jpg 40%');
        const state = flowAt(timeline.entries, 'p2p:me|them', entry.at);
        expect(state.rxSpeed).toBe('1 MB/s');
    });

    it('opens a wire: offer and answer on the tracker, then the handshake on the direct path', () => {
        const { emitter, timeline } = setup();
        emitter.emit('wire', { peerId: 'them', type: 'webrtc' }, 'peer them', torrent);
        const flights = timeline.entries[timeline.entries.length - 1].flights;
        expect(flights.map(f => [f.routeId, f.label, f.reverse])).toEqual([
            ['tracker:me', 'offer', false], ['tracker:me', 'answer', true],
            ['p2p:me|them', 'handshake', false], ['p2p:me|them', 'bitfield', true],
        ]);
    });

    it('draws a tracker announce and its answer', () => {
        const { emitter, timeline } = setup();
        emitter.emit('trackerAnnounce', { torrent });
        const entry = timeline.entries.at(-1);
        expect(entry.kind).toBe('trk');
        expect(entry.text).toContain('announce beach.jpg');
        expect(entry.flights.map(f => [f.label, f.reverse])).toEqual([['announce', false], ['peers', true]]);
    });

    it('shows the STUN binding when the public address comes back, only for our own NAT', () => {
        const { emitter, timeline } = setup();
        emitter.emit('pcEvent', 'icecandidate', 'srflx 203.0.113.7:51234');
        const entry = timeline.entries[timeline.entries.length - 1];
        // Our SSE path goes out through no NAT node here, so nothing flies.
        expect(entry.flights).toHaveLength(0);
        expect(entry.text).toContain('srflx 203.0.113.7:51234');
    });

    it('flies the binding request and the address STUN saw', () => {
        const emitter = new EventEmitter();
        const timeline = createTimeline();
        const natted = () => ({ routes: [
            { id: 'sse:me', kind: 'sse', path: ['me', 'nat:1', 'edge', 'api'], peerId: 'me' },
            { id: 'stun:nat:1', kind: 'stun', path: ['nat:1', 'stun'] },
        ] });
        attachTraffic({ timeline, emitter, getScene: natted, getMyId: () => 'me' });
        emitter.emit('pcEvent', 'icegatheringstatechange', 'gathering');
        expect(timeline.entries.at(-1).flights.map(f => [f.routeId, f.label, f.reverse]))
            .toEqual([['stun:nat:1', 'Binding Request', false]]);
        emitter.emit('pcEvent', 'icecandidate', 'srflx 203.0.113.7:51234');
        expect(timeline.entries.at(-1).flights.map(f => [f.routeId, f.label, f.reverse]))
            .toEqual([['stun:nat:1', 'Binding Success 203.0.113.7:51234', true]]);
        // A state change with no value says nothing and is not recorded.
        emitter.emit('pcEvent', 'icegatheringstatechange', '');
        expect(timeline.entries).toHaveLength(2);
    });

    it('asks TURN for a relay address, and draws the answer only when it comes', () => {
        const emitter = new EventEmitter();
        const timeline = createTimeline();
        const withTurn = () => ({ routes: [
            { id: 'stun:me', kind: 'stun', path: ['me', 'stun'], peerId: 'me' },
            { id: 'turnctl:me', kind: 'turnctl', path: ['me', 'turn'], peerId: 'me' },
        ] });
        attachTraffic({ timeline, emitter, getScene: withTurn, getMyId: () => 'me' });
        emitter.emit('pcEvent', 'icegatheringstatechange', 'gathering');
        // No NAT known yet: the request goes from the device itself.
        expect(timeline.entries.at(-1).flights.map(f => [f.routeId, f.label]))
            .toEqual([['stun:me', 'Binding Request'], ['turnctl:me', 'Allocate Request']]);
        emitter.emit('pcEvent', 'icecandidate', 'relay 192.0.2.9:49152');
        expect(timeline.entries.at(-1).flights.map(f => [f.routeId, f.label, f.reverse]))
            .toEqual([['turnctl:me', 'Allocate Success 192.0.2.9:49152', true]]);
    });

    it('puts WebRTC stats on the path, and its STUN checks as packets', () => {
        const { emitter, timeline } = setup();
        const stat = {
            peerId: 'them', rtt: 23.4, rx: 40000, tx: 1000, checks: 1, answers: 1,
            local: 'srflx', remote: 'host', protocol: 'udp', relayProtocol: '', localAddress: 'a:1', remoteAddress: 'b:2',
        };
        emitter.emit('linkStats', stat);
        const first = timeline.entries.at(-1);
        expect(first.route).toBe('p2p:me|them');
        expect(first.stats).toMatchObject({ rtt: 23.4, rx: 40000, local: 'srflx' });
        expect(first.flights.map(f => [f.label, f.reverse])).toEqual([['STUN check', false], ['check OK 23 ms', true]]);
        // A new path writes a line; the same path again does not.
        expect(first.text).toContain('path peer them · srflx ⇄ host udp · rtt 23 ms');
        emitter.emit('linkStats', { ...stat, checks: 0, answers: 0 });
        const second = timeline.entries.at(-1);
        expect(second.text).toBe('');
        expect(second.flights).toEqual([]);
        expect(flowAt(timeline.entries, 'p2p:me|them', second.at).stats.rtt).toBe(23.4);
    });

    it('draws no packets when motion is reduced, but still writes the log', () => {
        const { emitter, timeline } = setup({ animate: () => false });
        emitter.emit('photos', { type: 'add', item: [{ fileName: 'beach.jpg', peerId: 'them' }] });
        expect(timeline.recent()[0].text).toContain('beach.jpg');
        expect(timeline.recent()[0].flights).toHaveLength(0);
    });

    it('stops recording when detached', () => {
        const { emitter, timeline, stop } = setup();
        emitter.emit('peers', { type: 'add', item: { name: 'Ana', peerId: 'them' } });
        stop();
        emitter.emit('peers', { type: 'add', item: { name: 'Bo', peerId: 'other' } });
        expect(timeline.recent()).toHaveLength(1);
    });

    it('flies a server copy up in chunks and down as it streams, with its progress on the route', () => {
        const { emitter, timeline, clock } = setup();
        emitter.emit('serverCopy', { infoHash: 'abc', direction: 'up', stage: 'uploading', loaded: 8000000, total: 20000000, name: 'clip.mp4' });
        const up = timeline.entries.at(-1);
        expect(up.flights[0]).toMatchObject({ routeId: 'copies:me', reverse: false, label: 'PUT 8 MB/20 MB' });
        expect(up.text).toContain('server copy ↑ PUT uploading 8 MB/20 MB 40% · clip.mp4');
        // Between chunks the route keeps saying where the upload is.
        clock.value += 30000;
        expect(flowAt(timeline.entries, 'copies:me', clock.value).note).toBe('PUT 8 MB/20 MB');

        emitter.emit('serverCopy', { infoHash: 'abc', direction: 'down', stage: 'requested', why: 'no P2P progress for 10 s' });
        expect(timeline.entries.at(-1).flights[0].label).toBe('POST /request');
        expect(timeline.entries.at(-1).text).toContain('no P2P progress for 10 s');
        emitter.emit('serverCopy', { infoHash: 'abc', direction: 'down', stage: 'downloading', loaded: 1000000, total: 2000000 });
        const down = timeline.entries.at(-1).flights[0];
        expect(down.reverse).toBe(true);
        expect(down.label).toBe('GET 1 MB/2 MB');

        // Finished: the route goes back to hidden once the moment passes.
        emitter.emit('serverCopy', { infoHash: 'abc', direction: 'down', stage: 'done', loaded: 2000000, total: 2000000 });
        clock.value += FLOW_MS + 1;
        expect(flowAt(timeline.entries, 'copies:me', clock.value)).toBeNull();
    });
});

describe('flowAt', () => {
    it('says nothing about a route that has been quiet', () => {
        expect(flowAt([], 'p2p:me|them', 1000)).toBeNull();
        const entries = [{ at: 1000, kind: 'rx', route: 'p2p:me|them', count: 1 }];
        expect(flowAt(entries, 'p2p:me|them', 1000 + FLOW_MS + 1)).toBeNull();
        expect(flowAt(entries, 'other:route', 1000)).toBeNull();
    });

    it('adds up pieces in both directions inside the window', () => {
        const entries = [
            { at: 1000, kind: 'rx', route: 'r', count: 3 },
            { at: 1200, kind: 'rx', route: 'r', count: 4 },
            { at: 1400, kind: 'tx', route: 'r', count: 1, speed: '2 MB/s' },
        ];
        expect(flowAt(entries, 'r', 1500)).toEqual({ rx: 7, tx: 1, at: 1400, txSpeed: '2 MB/s' });
    });

    it('ignores traffic that happened after the moment being shown', () => {
        const entries = [
            { at: 1000, kind: 'rx', route: 'r', count: 3 },
            { at: 4000, kind: 'rx', route: 'r', count: 9 },
        ];
        expect(flowAt(entries, 'r', 2000).rx).toBe(3);
    });
});

describe('traffic through the timeline', () => {
    it('lets a paused room be stepped back through its pieces one at a time', () => {
        const { emitter, timeline, clock } = setup();

        // Pieces a second apart, the way a real download spaces them.
        for (let index = 0; index < 4; index++) {
            clock.value = index * 1000;
            emitter.emit('pieceReceived', { torrent, index, total: 4, size: 1024, peerId: 'them' });
        }
        const shown = timeline.entries.filter(entry => entry.flights.length);
        expect(shown.map(entry => entry.count)).toEqual([1, 1, 1, 1]);

        // Live at the last piece: its dot is on the route.
        clock.value = 3000;
        const pinned = timeline.pause();
        expect(pinned).toBe(3000);
        expect(timeline.inFlight(pinned).map(f => f.routeId)).toContain('p2p:me|them');

        // One step back is the piece before it, and the route label counts
        // only what had crossed by that moment.
        timeline.step(-1);
        expect(timeline.shown().id).toBe(shown[2].id);
        expect(flowAt(timeline.entries, 'p2p:me|them', timeline.clock()).rx).toBe(3);
        timeline.step(-1);
        expect(timeline.shown().id).toBe(shown[1].id);
        expect(flowAt(timeline.entries, 'p2p:me|them', timeline.clock()).rx).toBe(2);
    });

    it('writes one log line per piece stream, not one per piece', () => {
        const emitter = new EventEmitter();
        const timeline = createTimeline();
        attachTraffic({ timeline, emitter, getScene: scene, getMyId: () => 'me' });
        for (let index = 0; index < 4; index++) {
            emitter.emit('pieceReceived', { torrent, index, total: 4, size: 1024, peerId: 'them' });
        }
        expect(timeline.entries).toHaveLength(4);
        expect(timeline.recent()).toHaveLength(1);
        expect(timeline.recent()[0].text).toMatch(/piece \d\/4/);
        vi.resetAllMocks();
    });
});
