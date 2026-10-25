import React from 'react';
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { createRoot } from 'react-dom/client';
import { act } from 'react';
import { EventEmitter } from 'events';
import { createTheme, ThemeProvider } from '@mui/material/styles';

vi.mock('notistack', async () => {
    const actual = await vi.importActual('notistack');
    return { ...actual, withSnackbar: Component => Component };
});
vi.mock('../forgetDevice', () => ({ forgetDevice: vi.fn() }));

import SettingsView from './SettingsView';
import { forgetDevice } from '../forgetDevice';
import { readColors } from '../colors';

const button = text => [...document.body.querySelectorAll('button')].find(item => item.textContent === text);

async function render() {
    const master = { emitter: new EventEmitter(), client: { peerId: 'me' }, service: {} };
    const div = document.createElement('div');
    document.body.appendChild(div);
    const root = createRoot(div);
    await act(async () => root.render(
        <ThemeProvider theme={createTheme()}>
            <SettingsView master={master} enqueueSnackbar={vi.fn()} />
        </ThemeProvider>
    ));
    return async () => {
        await act(async () => root.unmount());
        div.remove();
    };
}


function memoryStorage() {
    const items = new Map();
    return {
        getItem: key => (items.has(key) ? items.get(key) : null),
        setItem: (key, value) => items.set(key, String(value)),
        removeItem: key => items.delete(key),
        clear: () => items.clear(),
    };
}

describe('SettingsView', () => {
    beforeEach(() => vi.stubGlobal('localStorage', memoryStorage()));

    it('turns on "Remove location when I share" for this browser', async () => {
        const unmount = await render();
        const input = [...document.body.querySelectorAll('label')]
            .find(label => label.textContent.startsWith('Remove location when I share')).querySelector('input');
        expect(input.checked).toBe(false);
        await act(async () => input.click());
        expect(localStorage.getItem('photogroup.removeLocation')).toBe('true');
        await unmount();
    });

    it('keeps "Tell me about new photos" off when the browser says no', async () => {
        vi.stubGlobal('Notification', { permission: 'denied', requestPermission: vi.fn() });
        const unmount = await render();
        const input = [...document.body.querySelectorAll('label')]
            .find(label => label.textContent.startsWith('Tell me about new photos')).querySelector('input');
        await act(async () => input.click());
        expect(input.checked).toBe(false);
        expect(localStorage.getItem('photogroup.notify')).toBe('false');
        await unmount();
    });

    it('has only name, sharing, colors, logs and this device', async () => {
        const unmount = await render();
        const text = document.body.textContent;
        for (const gone of ['Topology', 'Me View', 'Sequential', 'Restart Trackers', 'Private rooms', 'Keep Copies']) {
            expect(text).not.toContain(gone);
        }
        expect(button('Same as device').getAttribute('aria-pressed')).toBe('true');
        expect(button('Copy logs')).toBeTruthy();
        await unmount();
    });

    it('keeps the colors pick', async () => {
        const unmount = await render();
        await act(async () => button('Light').click());
        expect(readColors()).toBe('light');
        expect(button('Light').getAttribute('aria-pressed')).toBe('true');
        await unmount();
    });

    it('asks once before it forgets this device', async () => {
        const unmount = await render();
        await act(async () => button('Forget this device').click());
        expect(forgetDevice).not.toHaveBeenCalled();
        await act(async () => button('Delete my data').click());
        expect(forgetDevice).toHaveBeenCalledTimes(1);
        await unmount();
    });
});
