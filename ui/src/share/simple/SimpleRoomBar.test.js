import React from 'react';
import { describe, it, expect, vi } from 'vitest';
import { createRoot } from 'react-dom/client';
import { act } from 'react';
import EventEmitter from 'eventemitter3';
vi.mock('clipboard-copy', () => ({ default: vi.fn().mockResolvedValue() }));

const { default: copy } = await import('clipboard-copy');
const { default: SimpleRoomBar } = await import('./SimpleRoomBar');

async function render(peers) {
    const master = {
        emitter: new EventEmitter(),
        service: { id: 'room-1' },
        peers: { items: peers },
        leaveRoomAndReload: vi.fn(),
    };
    const div = document.createElement('div');
    const root = createRoot(div);
    await act(async () => root.render(<SimpleRoomBar master={master} />));
    return { div, root, master };
}

describe('SimpleRoomBar', () => {
    it('shows the code to scan while nobody else is here', async () => {
        const { div, root } = await render([{ peerId: 'me' }]);
        expect(div.textContent).toContain('Just you so far');
        expect(div.textContent).toContain('Let the people next to you scan this');
        expect(div.querySelector('svg')).not.toBeNull();
        expect(div.querySelector('label[for="contained-button-file"]').textContent).toContain('Share photos or clips');
        await act(async () => root.unmount());
    });

    it('counts people as they join and tucks the code behind a button', async () => {
        const { div, root, master } = await render([{ peerId: 'me' }]);
        await act(async () => master.emitter.emit('numPeersChange', 3));
        expect(div.textContent).toContain('3 people here');
        const addPeople = Array.from(div.querySelectorAll('button')).find(button => button.textContent === 'Add people');
        expect(addPeople).toBeTruthy();
        await act(async () => addPeople.click());
        expect(div.textContent).toContain('Hide code');
        await act(async () => root.unmount());
    });

    it('leaves the room', async () => {
        const { div, root, master } = await render([]);
        const leave = Array.from(div.querySelectorAll('button')).find(button => button.textContent === 'Leave');
        await act(async () => leave.click());
        expect(master.leaveRoomAndReload).toHaveBeenCalled();
        await act(async () => root.unmount());
    });

    it('copies the link when the share sheet fails', async () => {
        navigator.share = vi.fn().mockRejectedValue(Object.assign(new Error('no'), { name: 'NotAllowedError' }));
        try {
            const { div, root } = await render([]);
            const send = Array.from(div.querySelectorAll('button')).find(button => button.textContent === 'Send the link instead');
            await act(async () => send.click());
            expect(copy).toHaveBeenCalledWith(window.location.origin + '?room=room-1');
            expect(div.textContent).toContain('Link copied');
            await act(async () => root.unmount());
        } finally {
            delete navigator.share;
        }
    });
});
