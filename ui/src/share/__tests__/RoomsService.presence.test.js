import { describe, it, expect, vi, afterEach } from 'vitest';
import EventEmitter from 'eventemitter3';
import RoomsService from '../RoomsService';

class FakeEventSource {
    static CLOSED = 2;
    static instances = [];
    constructor(url) {
        this.url = url;
        this.readyState = 0;
        this.listeners = {};
        FakeEventSource.instances.push(this);
    }
    addEventListener(name, fn) { (this.listeners[name] = this.listeners[name] || []).push(fn); }
    fire(name, event = {}) { (this.listeners[name] || []).forEach(fn => fn(event)); }
    close() { this.readyState = FakeEventSource.CLOSED; }
}

function service() {
    const emitter = new EventEmitter();
    const rooms = new RoomsService(emitter);
    rooms.id = 'room1';
    rooms.hasRoom = true;
    rooms.sessionToken = 'tok';
    rooms.master = { client: { peerId: 'peer+1' } };
    return { rooms, emitter };
}

afterEach(() => {
    vi.unstubAllGlobals();
    FakeEventSource.instances = [];
});

describe('RoomsService presence', () => {
    it('sends an away beacon with the session proof', () => {
        const sendBeacon = vi.fn().mockReturnValue(true);
        vi.stubGlobal('navigator', { ...navigator, sendBeacon });
        const { rooms } = service();
        expect(rooms.markAway()).toBe(true);
        expect(sendBeacon).toHaveBeenCalledWith('/api/rooms/room1/peers/peer%2B1/away?sessionId='
            + encodeURIComponent(rooms.sessionId) + '&token=tok');
    });

    it('asks for a re-sync when the browser reconnects the update stream on its own', () => {
        vi.stubGlobal('EventSource', FakeEventSource);
        const { rooms, emitter } = service();
        const resynced = vi.fn();
        emitter.on('sseReconnected', resynced);

        rooms.listenToUrlChanges();
        const source = FakeEventSource.instances[0];
        source.fire('open');
        expect(resynced).not.toHaveBeenCalled(); // a fresh stream: its opener syncs

        source.fire('error'); // dropped, browser retries
        source.fire('open');
        expect(resynced).toHaveBeenCalledTimes(1);
        source.fire('open');
        expect(resynced).toHaveBeenCalledTimes(1);
    });

    it('marks a join made from the background as away', () => {
        const { rooms } = service();
        rooms.master = { client: { peerId: 'p' }, originPlatform: 'test' };
        const spy = vi.spyOn(document, 'visibilityState', 'get').mockReturnValue('hidden');
        try {
            expect(rooms.peerData.away).toBe(true);
        } finally {
            spy.mockRestore();
        }
        expect(rooms.peerData.away).toBe(false);
    });
});
