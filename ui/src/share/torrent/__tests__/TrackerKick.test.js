import { describe, it, expect, vi, beforeEach } from 'vitest';
import { EventEmitter } from 'events';

// The real bittorrent-tracker WebSocket tracker, on a fake socket: these
// tests pin down the private state TrackerKick relies on.
const { sockets } = vi.hoisted(() => ({ sockets: [] }));
vi.mock('@thaunknown/simple-websocket', async () => {
    const { EventEmitter } = await import('events');
    class FakeSocket extends EventEmitter {
        constructor({ url }) {
            super();
            this.url = url;
            this.connected = false;
            this.sent = [];
            this.destroyed = false;
            sockets.push(this);
        }
        connect() { this.connected = true; this.emit('connect'); }
        send(message) { this.sent.push(JSON.parse(message)); }
        destroy() {
            if (this.destroyed) return;
            this.destroyed = true;
            this.connected = false;
            this.emit('close');
        }
    }
    return { default: FakeSocket };
});

const { default: WebSocketTracker } = await import('bittorrent-tracker/websocket-tracker');
const { default: TrackerKick, kickTrackers, isWaiting, STALE_AFTER_HIDDEN_MS } = await import('../TrackerKick');

const URL_A = 'wss://tracker.test/a';
const URL_B = 'wss://tracker.test/b';

function torrentWith(...urls) {
    const client = new EventEmitter();
    Object.assign(client, {
        _infoHashBinary: 'x'.repeat(20),
        _peerIdBinary: 'y'.repeat(20),
        // No offers: jsdom has no WebRTC.
        _defaultAnnounceOpts: () => ({ numwant: 0 }),
    });
    client.on('warning', () => {});
    const trackers = urls.map(url => new WebSocketTracker(client, url));
    client._trackers = trackers;
    return { discovery: { tracker: client }, trackers };
}

const announces = socket => socket.sent.filter(message => message.action === 'announce');
const live = url => sockets.filter(socket => socket.url === url && !socket.destroyed);

beforeEach(() => {
    sockets.length = 0;
    Object.keys(WebSocketTracker._socketPool).forEach(key => delete WebSocketTracker._socketPool[key]);
});

describe('TrackerKick against bittorrent-tracker', () => {
    it('reopens a dropped tracker at once instead of after the library jitter', () => {
        const torrent = torrentWith(URL_A);
        live(URL_A)[0].connect();
        live(URL_A)[0].destroy(); // network drop
        const [tracker] = torrent.trackers;
        expect(isWaiting(tracker)).toBe(true);
        expect(tracker.reconnectTimer).toBeTruthy();

        expect(kickTrackers([torrent])).toBe(1);
        expect(tracker.reconnectTimer).toBeNull();
        const [fresh] = live(URL_A);
        fresh.connect();
        expect(announces(fresh)).toHaveLength(1); // back in the swarm
        expect(tracker.reconnecting).toBe(false);
        expect(isWaiting(tracker)).toBe(false);
    });

    it('leaves healthy trackers alone unless the sockets are stale', () => {
        const torrent = torrentWith(URL_A);
        live(URL_A)[0].connect();
        expect(kickTrackers([torrent])).toBe(0);
        expect(sockets).toHaveLength(1);
    });

    it('replaces a zombie socket shared by several torrents with one fresh socket', () => {
        const first = torrentWith(URL_A, URL_B);
        const second = torrentWith(URL_A);
        live(URL_A)[0].connect();
        live(URL_B)[0].connect();
        const zombie = live(URL_A)[0];
        expect(zombie.consumers).toBe(2);

        expect(kickTrackers([first, second], { stale: true })).toBe(3);
        expect(zombie.destroyed).toBe(true);
        expect(live(URL_A)).toHaveLength(1);
        expect(live(URL_B)).toHaveLength(1);
        const fresh = live(URL_A)[0];
        expect(fresh).not.toBe(zombie);
        expect(fresh.consumers).toBe(2);

        fresh.connect();
        live(URL_B)[0].connect();
        // Each torrent announced again on the new socket, with fresh offers.
        expect(announces(fresh)).toHaveLength(2);
        expect([...first.trackers, ...second.trackers].every(t => !t.destroyed && !t.reconnecting)).toBe(true);
    });

    it('frees a tracker the library left stuck on a shared socket', () => {
        const first = torrentWith(URL_A);
        const second = torrentWith(URL_A);
        live(URL_A)[0].destroy();
        // The library's own timers firing close together: the second
        // tracker joins the first one's socket before it has connected.
        first.trackers[0]._openSocket();
        second.trackers[0]._openSocket();
        const socket = live(URL_A)[0];
        socket.connect();
        expect(announces(socket)).toHaveLength(1);
        expect(second.trackers[0].reconnecting).toBe(true);

        expect(kickTrackers([first, second])).toBe(1);
        expect(announces(socket)).toHaveLength(2);
        expect(second.trackers[0].reconnecting).toBe(false);
    });

    it('treats a tracker still connecting after a reopen as busy', () => {
        const torrent = torrentWith(URL_A);
        live(URL_A)[0].destroy();
        kickTrackers([torrent]);
        expect(kickTrackers([torrent])).toBe(0); // no second socket stacked on the first
        expect(live(URL_A)).toHaveLength(1);
        expect(live(URL_A)[0].consumers).toBe(1);
    });
});

describe('TrackerKick', () => {
    it('counts a long sleep or a network change as stale', () => {
        const torrent = torrentWith(URL_A);
        live(URL_A)[0].connect();
        const kick = new TrackerKick({ getTorrents: () => [torrent] });
        expect(kick.kick({ hiddenMs: 1000 })).toBe(0);
        expect(kick.kick({ hiddenMs: STALE_AFTER_HIDDEN_MS })).toBe(1);
        live(URL_A)[0].connect();
        expect(kick.kick({ networkChanged: true })).toBe(1);
    });

    it('watchdog retries a dropped tracker with backoff, only while visible', () => {
        let now = 0;
        let visible = true;
        const torrent = torrentWith(URL_A);
        const kick = new TrackerKick({ getTorrents: () => [torrent], isVisible: () => visible, now: () => now, watchdogMs: 1000 });
        live(URL_A)[0].destroy();

        visible = false;
        expect(kick.tick()).toBe(0);
        visible = true;
        expect(kick.tick()).toBe(1);
        live(URL_A)[0].destroy(); // still down
        now += 500;
        expect(kick.tick()).toBe(0); // waits out 1 s
        now += 600;
        expect(kick.tick()).toBe(1);
        live(URL_A)[0].destroy();
        now += 1100;
        expect(kick.tick()).toBe(0); // now 2 s
        now += 1000;
        expect(kick.tick()).toBe(1);

        live(URL_A)[0].connect();
        expect(kick.tick()).toBe(0);
    });
});
