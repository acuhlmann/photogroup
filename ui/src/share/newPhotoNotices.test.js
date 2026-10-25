import { describe, it, expect, vi, beforeEach } from 'vitest';
import { EventEmitter } from 'events';
import { askToNotify, noticeText, watchNewPhotos } from './newPhotoNotices';

function memoryStorage() {
    const items = new Map();
    return {
        getItem: key => (items.has(key) ? items.get(key) : null),
        setItem: (key, value) => items.set(key, String(value)),
        removeItem: key => items.delete(key),
    };
}

function setup({ permission = 'granted', hidden = true } = {}) {
    const shown = [];
    function FakeNotification(title, options) {
        shown.push({ title, ...options });
    }
    FakeNotification.permission = permission;
    FakeNotification.requestPermission = vi.fn().mockResolvedValue('granted');
    const win = { Notification: FakeNotification, focus: vi.fn() };
    const doc = { hidden, title: 'Beach day · PhotoGroup' };
    const emitter = new EventEmitter();
    let fire;
    const stop = watchNewPhotos({ emitter, getMyPeerId: () => 'me', win, doc, setTimer: fn => { fire = fn; return 1; } });
    return { emitter, shown, win, doc, stop, flush: () => fire?.() };
}

describe('new photo notices', () => {
    beforeEach(() => {
        vi.stubGlobal('localStorage', memoryStorage());
        localStorage.setItem('photogroup.notify', 'true');
    });

    it('shows one notice for photos others add while the page is in the background', () => {
        const { emitter, shown, flush } = setup();
        emitter.emit('photos', { type: 'add', item: [{ peerId: 'friend' }, { peerId: 'friend' }] });
        emitter.emit('photos', { type: 'add', item: [{ peerId: 'me' }] });
        emitter.emit('photos', { type: 'add', item: [{ peerId: 'other' }] });
        flush();
        expect(shown).toEqual([{ title: 'Beach day · PhotoGroup', body: 'Someone added 3 photos.', tag: 'photogroup-new-photos' }]);
    });

    it('stays quiet in front, when it is off, or without permission', () => {
        for (const options of [{ hidden: false }, { permission: 'denied' }]) {
            const { emitter, shown, flush } = setup(options);
            emitter.emit('photos', { type: 'add', item: [{ peerId: 'friend' }] });
            flush();
            expect(shown).toEqual([]);
        }
        localStorage.setItem('photogroup.notify', 'false');
        const { emitter, shown, flush } = setup();
        emitter.emit('photos', { type: 'add', item: [{ peerId: 'friend' }] });
        flush();
        expect(shown).toEqual([]);
    });

    it('uses the service worker where the browser has no Notification constructor', async () => {
        const { emitter, win, flush } = setup();
        const showNotification = vi.fn().mockResolvedValue();
        const Throwing = function () { throw new TypeError('Illegal constructor'); };
        Throwing.permission = 'granted';
        win.Notification = Throwing;
        win.navigator = { serviceWorker: { ready: Promise.resolve({ showNotification }) } };
        emitter.emit('photos', { type: 'add', item: [{ peerId: 'friend' }] });
        flush();
        await vi.waitFor(() => expect(showNotification).toHaveBeenCalledWith('Beach day · PhotoGroup',
            { body: 'Someone added a photo.', tag: 'photogroup-new-photos' }));
    });

    it('asks the browser once', async () => {
        const { win } = setup({ permission: 'default' });
        expect(await askToNotify(win)).toBe(true);
        expect(win.Notification.requestPermission).toHaveBeenCalledTimes(1);
        expect(await askToNotify({})).toBe(false);
        expect(noticeText(1)).toBe('Someone added a photo.');
    });
});
