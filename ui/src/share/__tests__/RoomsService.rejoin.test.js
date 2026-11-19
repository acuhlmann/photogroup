import { describe, it, expect, vi, afterEach } from 'vitest';
import EventEmitter from 'eventemitter3';
import RoomsService from '../RoomsService';

// The server restarted (a deploy, or the VM stopped) and forgot this page's
// session, but the page still showed the room: "Name the room" said "Could
// not change the name. Try again." every time (2026-11-19).

function service() {
    const rooms = new RoomsService(new EventEmitter());
    rooms.id = 'room1';
    rooms.hasRoom = true;
    rooms.sessionToken = 'old';
    const master = {
        client: { peerId: 'peer1' },
        // Like TorrentMaster: joins through the service it is given.
        findExistingContent: vi.fn(async join => {
            await join.call(rooms);
            return [];
        }),
    };
    rooms.master = master;
    rooms.joinRoom = vi.fn(async () => { rooms.sessionToken = 'new'; return { photos: [], peers: [] }; });
    return { rooms, master };
}

const answer = (status, body = {}) => ({ ok: status < 300, status, json: async () => body, text: async () => '' });

afterEach(() => vi.unstubAllGlobals());

describe('RoomsService joins again when the server forgot this page', () => {
    it('renames the room after joining again on a 403', async () => {
        const fetch = vi.fn()
            .mockResolvedValueOnce(answer(403))
            .mockResolvedValueOnce(answer(200, { name: 'Work Lunch Group' }));
        vi.stubGlobal('fetch', fetch);
        const { rooms, master } = service();

        await expect(rooms.updateRoomSettings({ name: 'Work Lunch Group' })).resolves.toEqual({ name: 'Work Lunch Group' });

        expect(master.findExistingContent).toHaveBeenCalledTimes(1);
        expect(fetch).toHaveBeenCalledTimes(2);
        expect(fetch.mock.calls[0][1].headers['X-Session-Token']).toBe('old');
        expect(fetch.mock.calls[1][1].headers['X-Session-Token']).toBe('new');
    });

    it('joins again when the server lost the room too (404 on settings)', async () => {
        vi.stubGlobal('fetch', vi.fn()
            .mockResolvedValueOnce(answer(404))
            .mockResolvedValueOnce(answer(200, { name: 'x' })));
        const { rooms, master } = service();
        await rooms.updateRoomSettings({ name: 'x' });
        expect(master.findExistingContent).toHaveBeenCalledTimes(1);
    });

    it('tries only once more, then says it failed', async () => {
        const fetch = vi.fn().mockResolvedValue(answer(403));
        vi.stubGlobal('fetch', fetch);
        const { rooms } = service();
        await expect(rooms.updateRoomSettings({ name: 'x' })).rejects.toThrow('403');
        expect(fetch).toHaveBeenCalledTimes(2);
    });

    it('does not join again for a photo that is not there (404 on details)', async () => {
        const fetch = vi.fn().mockResolvedValue(answer(404));
        vi.stubGlobal('fetch', fetch);
        const { rooms, master } = service();
        await expect(rooms.updateDetails('abc', { title: 'x' })).rejects.toBeTruthy();
        expect(master.findExistingContent).not.toHaveBeenCalled();
        expect(fetch).toHaveBeenCalledTimes(1);
    });

    it('sends the new token in the body when photo details are retried', async () => {
        const fetch = vi.fn()
            .mockResolvedValueOnce(answer(403))
            .mockResolvedValueOnce(answer(200, { infoHash: 'abc' }));
        vi.stubGlobal('fetch', fetch);
        const { rooms } = service();
        await rooms.updateDetails('abc', { title: 'x' });
        expect(JSON.parse(fetch.mock.calls[1][1].body).sessionToken).toBe('new');
    });

    it('shares one join between requests that fail together', async () => {
        vi.stubGlobal('fetch', vi.fn()
            .mockResolvedValueOnce(answer(403))
            .mockResolvedValueOnce(answer(403))
            .mockResolvedValue(answer(200, {})));
        const { rooms, master } = service();
        await Promise.all([rooms.updateRoomSettings({ name: 'a' }), rooms.updateRoomSettings({ keepCopies: true })]);
        expect(master.findExistingContent).toHaveBeenCalledTimes(1);
    });
});
