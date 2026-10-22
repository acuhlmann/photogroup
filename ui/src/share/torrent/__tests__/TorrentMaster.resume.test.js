import { describe, it, expect, vi } from 'vitest';
import TorrentMaster from '../TorrentMaster';
import TorrentCreator from '../TorrentCreator';

function fakeMaster() {
    const master = Object.create(TorrentMaster.prototype);
    master._lastResumeAt = 0;
    master.trackerKick = { kick: vi.fn() };
    master.serverFallback = { resetClocks: vi.fn() };
    master.creator = { refreshIceServers: vi.fn().mockResolvedValue(false), client: { torrents: [] } };
    master.service = { reconnectUpdates: vi.fn(), markAway: vi.fn(), hasRoom: true, joinRoom: vi.fn() };
    master.findExistingContent = vi.fn().mockResolvedValue([]);
    return master;
}

describe('TorrentMaster resume', () => {
    it('reconnects trackers, SSE and the room, and gives P2P a fresh stall window', () => {
        const master = fakeMaster();
        master.handleResume('visible', { hiddenMs: 60000, networkChanged: false });

        expect(master.trackerKick.kick).toHaveBeenCalledWith({ hiddenMs: 60000, networkChanged: false });
        expect(master.serverFallback.resetClocks).toHaveBeenCalled();
        expect(master.creator.refreshIceServers).toHaveBeenCalled();
        expect(master.service.reconnectUpdates).toHaveBeenCalled();
        expect(master.findExistingContent).toHaveBeenCalledWith(master.service.joinRoom);
    });

    it('does it once when visibility and network events arrive together', () => {
        const master = fakeMaster();
        master.handleResume('visible', { hiddenMs: 60000 });
        master.handleResume('online', { networkChanged: true });
        expect(master.trackerKick.kick).toHaveBeenCalledTimes(1);
        expect(master.findExistingContent).toHaveBeenCalledTimes(1);
    });

    it('leaves the stall clocks alone when the page never slept', () => {
        const master = fakeMaster();
        master.handleResume('sse');
        expect(master.serverFallback.resetClocks).not.toHaveBeenCalled();
        expect(master.service.reconnectUpdates).not.toHaveBeenCalled(); // SSE already reopened itself
        expect(master.findExistingContent).toHaveBeenCalled();
    });

    it('tells the room it is only away when the page goes to the background', () => {
        const master = fakeMaster();
        master.handleHide();
        expect(master.service.markAway).toHaveBeenCalled();
    });

    it('restarts every tracker socket on request', () => {
        const master = fakeMaster();
        master.restartTrackers();
        expect(master.trackerKick.kick).toHaveBeenCalledWith({ networkChanged: true });
    });
});

describe('TorrentCreator.refreshIceServers', () => {
    it('swaps fresh TURN credentials into the config WebTorrent already holds', async () => {
        const fresh = [{ urls: 'turn:turn.test', username: 'u2', credential: 'c2' }];
        const service = { getRtcConfig: vi.fn().mockResolvedValue({ iceServers: fresh }) };
        const creator = new TorrentCreator(service, null, null, null);
        const config = { iceServers: [{ urls: 'turn:turn.test', username: 'u1', credential: 'c1' }] };
        creator.iceServers = config;
        creator.iceServersFetchedAt = 0;

        await expect(creator.refreshIceServers({ maxAgeMs: 1000, now: 500 })).resolves.toBe(false);
        expect(service.getRtcConfig).not.toHaveBeenCalled();

        await expect(creator.refreshIceServers({ maxAgeMs: 1000, now: 5000 })).resolves.toBe(true);
        expect(creator.iceServers).toBe(config);
        expect(config.iceServers).toBe(fresh);
    });

    it('keeps the old servers when the server sends none', async () => {
        const service = { getRtcConfig: vi.fn().mockResolvedValue(undefined) };
        const creator = new TorrentCreator(service, null, null, null);
        const old = [{ urls: 'stun:stun.test' }];
        creator.iceServers = { iceServers: old };
        await expect(creator.refreshIceServers({ maxAgeMs: 0, now: 1 })).resolves.toBe(false);
        expect(creator.iceServers.iceServers).toBe(old);
    });
});
