import React from 'react';
import { describe, it, expect, vi, afterEach } from 'vitest';
import { createRoot } from 'react-dom/client';
import { act } from 'react';
import EventEmitter from 'eventemitter3';

import PeerNameField from './PeerNameField';

// React owns the input's value; setting it behind its back needs the native
// setter plus the input event it listens for.
const type = (input, value) => {
    const setter = Object.getOwnPropertyDescriptor(window.HTMLInputElement.prototype, 'value').set;
    setter.call(input, value);
    input.dispatchEvent(new Event('input', { bubbles: true }));
};

const setup = (updatePeer) => {
    const master = {
        emitter: new EventEmitter(),
        client: { peerId: 'me' },
        me: { name: 'Mine' },
        peers: { items: [{ peerId: 'me', name: 'Mine' }] },
        service: { updatePeer },
    };
    const div = document.createElement('div');
    document.body.appendChild(div);
    return { master, div, root: createRoot(div) };
};

describe('PeerNameField', () => {
    afterEach(() => {
        localStorage.getItem.mockReset();
        localStorage.setItem.mockReset();
    });

    it('starts from the saved nickname', async () => {
        localStorage.getItem.mockReturnValue('Mine');
        const { master, div, root } = setup(vi.fn());
        await act(async () => root.render(<PeerNameField master={master} />));
        const input = div.querySelector('input');
        expect(input.value).toBe('Mine');
        // MUI 9 dropped TextField's `inputProps`: passing it leaks the object
        // onto the DOM input, React logs "does not recognize the prop", and the
        // E2E diagnostic spec fails the build on any critical console error.
        expect(input.maxLength).toBe(40);
        expect(input.getAttribute('inputprops')).toBeNull();
        await act(async () => root.unmount());
        div.remove();
    });

    it('sends a new name to the room and keeps the local record in step', async () => {
        localStorage.getItem.mockReturnValue('Mine');
        const updatePeer = vi.fn().mockResolvedValue({ peerId: 'me', name: 'Ana' });
        const { master, div, root } = setup(updatePeer);
        await act(async () => root.render(<PeerNameField master={master} />));

        const field = div.querySelector('input');
        await act(async () => type(field, 'Ana'));
        const save = Array.from(div.querySelectorAll('button')).find(button => button.textContent === 'Save');
        await act(async () => save.click());

        expect(updatePeer).toHaveBeenCalledWith({ name: 'Ana' });
        // Both places the map reads a name from, so the node relabels at once.
        expect(master.me.name).toBe('Ana');
        expect(master.peers.items[0].name).toBe('Ana');
        await act(async () => root.unmount());
        div.remove();
    });

    it('says so when the room refuses the name, rather than looking saved', async () => {
        localStorage.getItem.mockReturnValue('Mine');
        const { master, div, root } = setup(vi.fn().mockResolvedValue(null));
        await act(async () => root.render(<PeerNameField master={master} />));

        await act(async () => type(div.querySelector('input'), 'Ana'));
        await act(async () => Array.from(div.querySelectorAll('button'))
            .find(button => button.textContent === 'Save').click());

        expect(div.textContent).toContain("Couldn't save that name");
        expect(div.textContent).not.toContain('Saved');
        expect(master.me.name).toBe('Mine');
        await act(async () => root.unmount());
        div.remove();
    });

    it('sends on Enter, which is how the name gets changed from the map', async () => {
        localStorage.getItem.mockReturnValue('');
        const updatePeer = vi.fn().mockResolvedValue({ peerId: 'me', name: 'Bo' });
        const { master, div, root } = setup(updatePeer);
        await act(async () => root.render(<PeerNameField master={master} compact />));

        // Compact is the map's card: no Save button, so the key is the only way.
        expect(div.querySelector('button')).toBeNull();
        await act(async () => type(div.querySelector('input'), 'Bo'));
        await act(async () => div.querySelector('input').dispatchEvent(
            new KeyboardEvent('keydown', { bubbles: true, key: 'Enter' })));

        await vi.waitFor(() => expect(updatePeer).toHaveBeenCalledWith({ name: 'Bo' }));
        await act(async () => root.unmount());
        div.remove();
    });
});
