import React from 'react';
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { createRoot } from 'react-dom/client';
import { act } from 'react';
import EventEmitter from 'eventemitter3';

vi.mock('./pushNotices', () => ({
    enablePush: vi.fn(async () => true),
    syncPush: vi.fn(async () => true),
}));

import NotifyPrompt from './NotifyPrompt';
import { enablePush } from './pushNotices';

function memoryStorage() {
    const items = new Map();
    return {
        getItem: key => (items.has(key) ? items.get(key) : null),
        setItem: (key, value) => items.set(key, String(value)),
        removeItem: key => items.delete(key),
        clear: () => items.clear(),
    };
}

function fakeWin({ permission = 'default', grant = true } = {}) {
    const win = {
        Notification: {
            permission,
            requestPermission: vi.fn(async () => (grant ? 'granted' : 'denied')),
        },
    };
    return win;
}

async function render({ me = null, win = fakeWin() } = {}) {
    const master = { me, emitter: new EventEmitter(), service: { id: 'room-1' } };
    const div = document.createElement('div');
    document.body.appendChild(div);
    const root = createRoot(div);
    await act(async () => root.render(<NotifyPrompt master={master} win={win} />));
    const unmount = async () => {
        await act(async () => root.unmount());
        div.remove();
    };
    const card = () => document.body.querySelector('[data-testid="notify-prompt"]');
    const button = text => [...document.body.querySelectorAll('button')].find(item => item.textContent === text);
    return { master, win, card, button, unmount };
}

describe('NotifyPrompt', () => {
    beforeEach(() => {
        vi.stubGlobal('localStorage', memoryStorage());
        enablePush.mockClear();
    });

    it('offers a notice as soon as there is a room to be told about', async () => {
        const { master, card, unmount } = await render();
        expect(card()).toBeNull();
        await act(async () => master.emitter.emit('addPeerDone', {}));
        expect(card()).toBeTruthy();
        expect(card().textContent).toContain('Tell me when photos arrive');
        await unmount();
    });

    it('offers at once when the room was already open', async () => {
        const { card, unmount } = await render({ me: { peerId: 'me' } });
        expect(card()).toBeTruthy();
        await unmount();
    });

    it('takes the yes as permission asked, the choice on, and a push subscription', async () => {
        const { win, card, button, unmount } = await render({ me: { peerId: 'me' } });
        await act(async () => button('Tell me').click());
        expect(win.Notification.requestPermission).toHaveBeenCalledTimes(1);
        expect(localStorage.getItem('photogroup.notify')).toBe('true');
        expect(enablePush).toHaveBeenCalledWith(expect.objectContaining({ service: { id: 'room-1' } }));
        expect(card()).toBeNull();
        await unmount();
    });

    it('still keeps the in-page notice when the browser refuses the push part', async () => {
        enablePush.mockResolvedValueOnce(false);
        const { card, button, unmount } = await render({ me: { peerId: 'me' } });
        await act(async () => button('Tell me').click());
        expect(localStorage.getItem('photogroup.notify')).toBe('true');
        expect(card()).toBeNull();
        await unmount();
    });

    it('does not switch anything on when the browser says no to notifying', async () => {
        const win = fakeWin({ grant: false });
        const { button, unmount } = await render({ me: { peerId: 'me' }, win });
        await act(async () => button('Tell me').click());
        // Nothing switched on: off is the absence of the choice, not a written
        // false, so the page never claims a notice this browser refused.
        expect(localStorage.getItem('photogroup.notify')).toBeNull();
        expect(enablePush).not.toHaveBeenCalled();
        await unmount();
    });

    it('a no is remembered, and never asked again on this browser', async () => {
        const { card, button, unmount } = await render({ me: { peerId: 'me' } });
        await act(async () => button('Not now').click());
        expect(card()).toBeNull();
        await unmount();

        const again = await render({ me: { peerId: 'me' } });
        expect(again.card()).toBeNull();
        await again.unmount();
    });

    it('does not offer where the browser has no notifications, or has already been answered', async () => {
        const noApi = await render({ me: { peerId: 'me' }, win: {} });
        expect(noApi.card()).toBeNull();
        await noApi.unmount();

        const already = await render({ me: { peerId: 'me' }, win: fakeWin({ permission: 'denied' }) });
        expect(already.card()).toBeNull();
        await already.unmount();

        localStorage.setItem('photogroup.notify', 'true');
        const chosen = await render({ me: { peerId: 'me' } });
        expect(chosen.card()).toBeNull();
        await chosen.unmount();
    });

    it('says why it is asking, in the words a person on a phone needs', async () => {
        const { card, unmount } = await render({ me: { peerId: 'me' } });
        expect(card().textContent).toContain('Go and take the next one');
        expect(card().textContent).toContain('You get a notice when someone adds photos to this room');
        await unmount();
    });
});
