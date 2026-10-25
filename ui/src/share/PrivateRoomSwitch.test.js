import React from 'react';
import { describe, it, expect, beforeEach, vi } from 'vitest';
import { createRoot } from 'react-dom/client';
import { act } from 'react';
import PrivateRoomSwitch from './PrivateRoomSwitch';
import { keyForNewRoom, wantsPrivateRooms } from './privateRoom';


function memoryStorage() {
    const items = new Map();
    return {
        getItem: key => (items.has(key) ? items.get(key) : null),
        setItem: (key, value) => items.set(key, String(value)),
        removeItem: key => items.delete(key),
        clear: () => items.clear(),
    };
}

describe('PrivateRoomSwitch', () => {
    beforeEach(() => vi.stubGlobal('localStorage', memoryStorage()));

    it('is off by default and makes the next room private when on', async () => {
        const div = document.createElement('div');
        document.body.appendChild(div);
        const root = createRoot(div);
        await act(async () => root.render(<PrivateRoomSwitch />));
        const input = div.querySelector('input');
        expect(input.checked).toBe(false);
        expect(keyForNewRoom()).toBeNull();

        await act(async () => input.click());
        expect(input.checked).toBe(true);
        expect(wantsPrivateRooms()).toBe(true);
        expect(keyForNewRoom()).toMatch(/^[A-Za-z0-9_-]{43}$/);

        await act(async () => root.unmount());
        div.remove();
    });
});
