import { describe, it, expect, vi } from 'vitest';
import EventEmitter from 'eventemitter3';
import OfflineRoom, { checkedPhoto, plainPhoto } from './offlineRoom';
import RoomPhotos from '../torrent/RoomPhotos';

const ROOM = 'z45keexwrxqzbeqimgsz';
const HASH = n => String(n).repeat(40).slice(0, 40);
const photo = (n, more = {}) => ({
    infoHash: HASH(n), peerId: 'peer-a', url: 'magnet:?xt=urn:btih:' + HASH(n), fileName: `p${n}.jpg`, fileType: 'image/jpeg', ...more,
});

function memoryStore() {
    const items = new Map();
    return {
        items,
        get: (key, done) => done(null, items.get(key)),
        set: (key, value, done) => { items.set(key, JSON.parse(JSON.stringify(value))); done(null); },
    };
}

function phone({ store = memoryStore(), probe = async () => false } = {}) {
    const emitter = new EventEmitter();
    const events = [];
    emitter.on('photos', event => events.push(event));
    const service = {
        id: ROOM, hasRoom: true,
        sendShare: vi.fn(async photos => photos.map(item => ({ ...item, owners: [] }))),
        sharePoster: vi.fn(async () => ({})),
        updateRoomSettings: vi.fn(async () => ({})),
    };
    const master = { emitter, service, client: {}, roomPhotos: new RoomPhotos(emitter) };
    const room = new OfflineRoom(master, { store, probe, probeMs: 1e9 });
    clearInterval(room.timer);
    master.offlineRoom = room;
    return { room, master, service, emitter, events, store };
}

const saved = () => new Promise(resolve => setTimeout(resolve, 600));

describe('a room with no server', () => {
    it('opens empty when it is new, and says that the server is away', async () => {
        const { room, emitter } = phone();
        const away = vi.fn();
        emitter.on('serverAway', away);
        const opened = await room.openOffline({ create: true });
        expect(opened).toMatchObject({ photos: [], peers: [], connections: [], offline: true });
        expect(room.away).toBe(true);
        expect(away).toHaveBeenCalledWith(true);
    });

    it('keeps what the server lists, and opens from that copy after a reload', async () => {
        const store = memoryStore();
        const first = phone({ store });
        await first.room.reconcile({ photos: [photo(1, { owners: [{ peerId: 'x' }] })], settings: { name: 'Trip' } });
        first.room.apply({ type: 'add', item: [photo(2)] });
        first.room.apply({ type: 'update', item: [{ infoHash: HASH(1), poster: 'data:image/jpeg;base64,AAAA' }] });
        first.room.apply({ type: 'delete', item: HASH(2) });
        first.room.apply({ type: 'add', item: [photo(3)] });
        await saved();

        const second = phone({ store });
        const opened = await second.room.openOffline();
        expect(opened.settings).toEqual({ name: 'Trip' });
        expect(opened.photos.map(item => item.fileName).sort()).toEqual(['p1.jpg', 'p3.jpg']);
        expect(opened.photos.find(item => item.infoHash === HASH(1)).poster).toBe('data:image/jpeg;base64,AAAA');
        expect(opened.photos.every(item => Array.isArray(item.owners) && item.owners.length === 0)).toBe(true);
    });

    it('holds a photo that the server did not get, and gives it to the server later', async () => {
        const store = memoryStore();
        const { room, service } = phone({ store });
        await room.openOffline({ create: true });
        await room.hold([photo(1)]);
        room.holdPoster(HASH(1), 'data:image/jpeg;base64,AAAA');
        expect(room.descriptions()).toHaveLength(1);
        await saved();

        // After a reload, the server answers a join with an empty room.
        const later = phone({ store });
        const joined = await later.room.reconcile({ photos: [], settings: {} });
        expect(later.service.sendShare).toHaveBeenCalledTimes(1);
        expect(later.service.sendShare.mock.calls[0][0][0]).toMatchObject({ infoHash: HASH(1), fileName: 'p1.jpg' });
        expect(later.service.sharePoster).toHaveBeenCalledWith(HASH(1), 'data:image/jpeg;base64,AAAA');
        expect(joined.photos.map(item => item.infoHash)).toEqual([HASH(1)]);
        expect(later.room.away).toBe(false);
        expect(later.room.held.size).toBe(0);
        expect(service.sendShare).not.toHaveBeenCalled();
    });

    it('does not send a held photo that the server lists already', async () => {
        const { room, service } = phone();
        await room.openOffline();
        await room.hold([photo(1)]);
        await room.reconcile({ photos: [photo(1)], settings: {} });
        expect(service.sendShare).not.toHaveBeenCalled();
    });

    it('keeps the held photos on screen and held when the server does not take them', async () => {
        const { room, service } = phone();
        await room.openOffline();
        await room.hold([photo(1)]);
        service.sendShare.mockRejectedValueOnce(new TypeError('Failed to fetch'));
        const joined = await room.reconcile({ photos: [photo(2)], settings: {} });
        expect(joined.photos.map(item => item.infoHash)).toEqual([HASH(1), HASH(2)]);
        expect([...room.held]).toEqual([HASH(1)]);
    });

    it('learns a photo from a phone nearby once, and holds it for the server', async () => {
        const { room, events } = phone();
        await room.openOffline();
        expect(room.learn([photo(1, { owners: [{ peerId: 'x' }], hasServerCopy: true, torrent: { big: 1 } })])).toBe(1);
        expect(room.learn([photo(1)])).toBe(0);
        const added = events.filter(event => event.type === 'add');
        expect(added).toHaveLength(1);
        expect(added[0].item[0]).toMatchObject({ infoHash: HASH(1), fileName: 'p1.jpg', owners: [] });
        expect(added[0].item[0].hasServerCopy).toBeUndefined();
        expect(added[0].item[0].torrent).toBeUndefined();
        expect([...room.held]).toEqual([HASH(1)]);
    });

    it('adds photos that were shared together as one group', async () => {
        const { room, events } = phone();
        await room.openOffline();
        room.learn([photo(1, { infoHash: HASH(1) + '-a.jpg' }), photo(1, { infoHash: HASH(1) + '-b.jpg' }), photo(2)]);
        expect(events.filter(event => event.type === 'add').map(event => event.item.length)).toEqual([2, 1]);
    });

    it('takes the small picture of a known photo when it comes later', async () => {
        const { room, events } = phone();
        await room.openOffline();
        room.learn([photo(1)]);
        room.learn([photo(1, { poster: 'data:image/jpeg;base64,AAAA' })]);
        expect(room.describe(HASH(1)).poster).toBe('data:image/jpeg;base64,AAAA');
        expect(events.some(event => event.type === 'update' && event.item[0].poster)).toBe(true);
    });

    it('refuses what is not a photo of a room', () => {
        expect(checkedPhoto(null)).toBeNull();
        expect(checkedPhoto({ infoHash: 'short', peerId: 'a', url: 'magnet:?x' })).toBeNull();
        expect(checkedPhoto({ infoHash: HASH(1), peerId: 'a', url: 'https://bad.example/' })).toBeNull();
        expect(checkedPhoto(photo(1, { poster: 'data:text/html;base64,AAAA' })).poster).toBeUndefined();
        expect(plainPhoto({ infoHash: HASH(1), owners: [1] })).toEqual({ infoHash: HASH(1) });
    });

    it('joins the room again when the server answers', async () => {
        let there = false;
        const { room, master } = phone({ probe: async () => there });
        master.findExistingContent = vi.fn(async () => { room.setAway(false); });
        master.service.joinRoom = () => {};
        await room.openOffline();
        expect(await room.tryReturn()).toBe(false);
        expect(master.findExistingContent).not.toHaveBeenCalled();
        there = true;
        expect(await room.tryReturn()).toBe(true);
        expect(master.findExistingContent).toHaveBeenCalledTimes(1);
    });

    it('sees that the server went away while the room was open', async () => {
        const { room } = phone({ probe: async () => { throw new TypeError('Failed to fetch'); } });
        await room.check();
        expect(room.away).toBe(true);
    });
});
