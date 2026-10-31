import React from 'react';
import { describe, it, expect, vi } from 'vitest';
import { createRoot } from 'react-dom/client';
import { act } from 'react';
import EventEmitter from 'eventemitter3';
import RoomMenu, { LEFT_ROOM } from './RoomMenu';

const byText = text => Array.from(document.body.querySelectorAll('[role="menuitem"], button'))
    .find(item => item.textContent.startsWith(text));

async function render(name = '') {
    const master = {
        emitter: new EventEmitter(),
        service: {
            id: 'room-1',
            updateRoomSettings: vi.fn().mockResolvedValue({ keepCopies: false, name: 'Beach day' }),
            updatePeer: vi.fn().mockResolvedValue({ peerId: 'me', name: 'Ana' }),
        },
        client: { peerId: 'me' },
        me: { name: null },
        peers: { items: [{ peerId: 'me', name: null }] },
        device: 'Chrome on Samsung SM-S911B',
        roomPhotos: { all: () => [] },
        leaveRoomAndReload: vi.fn(),
    };
    const div = document.createElement('div');
    document.body.appendChild(div);
    const root = createRoot(div);
    await act(async () => root.render(<RoomMenu master={master} name={name} label={name || 'Room from 25 Oct'} />));
    const unmount = async () => {
        await act(async () => root.unmount());
        div.remove();
    };
    return { master, unmount };
}

describe('RoomMenu', () => {
    it('names the room for everyone', async () => {
        const { master, unmount } = await render();
        const settings = vi.fn();
        master.emitter.on('roomSettings', settings);
        await act(async () => document.querySelector('[aria-label^="Room: Room from 25 Oct"]').click());
        await act(async () => byText('Name the room').click());
        const input = document.body.querySelector('input');
        await act(async () => {
            const setter = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value').set;
            setter.call(input, '  Beach day ');
            input.dispatchEvent(new Event('input', { bubbles: true }));
        });
        await act(async () => byText('Save').click());
        expect(master.service.updateRoomSettings).toHaveBeenCalledWith({ name: 'Beach day' });
        expect(settings).toHaveBeenCalledWith({ keepCopies: false, name: 'Beach day' });
        await unmount();
    });

    it('leaves the room and says how to come back', async () => {
        const { master, unmount } = await render('Beach day');
        await act(async () => document.querySelector('[aria-label^="Room: Beach day"]').click());
        expect(byText('Change the name')).toBeTruthy();
        await act(async () => byText('Leave the room').click());
        expect(master.leaveRoomAndReload).toHaveBeenCalled();
        expect(sessionStorage.getItem('photogroup.notice')).toBe(LEFT_ROOM);
        await unmount();
    });

    it('lets a person change their name', async () => {
        localStorage.getItem.mockReturnValue(null);
        const { master, unmount } = await render();
        await act(async () => document.querySelector('[aria-label^="Room: Room from 25 Oct"]').click());
        const item = byText('Your name');
        expect(item.textContent).toContain('Chrome on Samsung SM-S911B');
        await act(async () => item.click());
        const input = document.body.querySelector('input');
        await act(async () => {
            const setter = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value').set;
            setter.call(input, '  Ana ');
            input.dispatchEvent(new Event('input', { bubbles: true }));
        });
        await act(async () => byText('Save').click());
        expect(master.service.updatePeer).toHaveBeenCalledWith({ name: 'Ana' });
        expect(master.me.name).toBe('Ana');
        expect(master.peers.items[0].name).toBe('Ana');
        localStorage.getItem.mockReset();
        await unmount();
    });
});
