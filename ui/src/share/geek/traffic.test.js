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

    it('sends a labelled SSE packet down every device route on a room change', () => {
        const { emitter, timeline } = setup();
        emitter.emit('photos', { type: 'add', item: [{ fileName: 'beach.jpg', peerId: 'them' }] });

        const flights = timeline.entries[timeline.entries.length - 1].flights;
        // Ours is named; the other device only shows that its stream moved.
        expect(flights.map(f => f.routeId)).toEqual(['sse:me']);
        expect(flights[0].label).toContain('SSE photos:add');
        expect(flights[0].reverse).toBe(true);
    });

    it('names our own upload as a magnet POST on the way out', () => {
        const { emitter, timeline } = setup();
        emitter.emit('photos', { type: 'add', item: [{ fileName: 'beach.jpg', peerId: 'me' }] });
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

    it('announces and swaps offers on the tracker socket', () => {
        const { emitter, timeline } = setup();
        emitter.emit('wire', { peerId: 'x', type: 'webrtc' }, 'peer them', torrent);
        const flights = timeline.entries[timeline.entries.length - 1].flights;
        expect(flights.map(f => [f.routeId, f.label, f.reverse]))
            .toEqual([['tracker:me', 'announce', false], ['tracker:me', 'offer/answer', true]]);
    });

    it('shows a STUN binding only for our own NAT', () => {
        const { emitter, timeline } = setup();
        emitter.emit('pcEvent', 'icegatheringstatechange', 'gathering');
        const entry = timeline.entries[timeline.entries.length - 1];
        // Our SSE path goes out through no NAT node here, so nothing is gathered on it.
        expect(entry.flights).toHaveLength(0);
        expect(entry.text).toContain('gathering');
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

    it('gives a server copy a chunk going up and one coming down', () => {
        const { emitter, timeline } = setup();
        emitter.emit('serverCopyBackup', { pending: 1 });
        expect(timeline.entries.at(-1).flights[0].label).toBe('PUT chunk ≤8 MB');
        emitter.emit('serverCopyReady', {});
        const down = timeline.entries.at(-1).flights[0];
        expect(down.label).toBe('GET copy');
        expect(down.reverse).toBe(true);
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
