import React from 'react';
import { describe, it, expect, vi } from 'vitest';
import { createRoot } from 'react-dom/client';
import { act } from 'react';
import { EventEmitter } from 'events';
import { createTheme, ThemeProvider } from '@mui/material/styles';

vi.mock('notistack', async () => {
    const actual = await vi.importActual('notistack');
    return { ...actual, withSnackbar: Component => Component };
});

import SettingsView from './SettingsView';

describe('SettingsView keep copies', () => {
    it('shows the room setting and changes it for the whole room', async () => {
        const emitter = new EventEmitter();
        const updateRoomSettings = vi.fn().mockResolvedValue({ keepCopies: true });
        const master = { emitter, client: { peerId: 'me' }, service: { updateRoomSettings }, restartTrackers: vi.fn() };
        const div = document.createElement('div');
        document.body.appendChild(div);
        const root = createRoot(div);
        await act(async () => root.render(
            <ThemeProvider theme={createTheme()}>
                <SettingsView master={master} prefersDarkMode={false} enqueueSnackbar={vi.fn()} />
            </ThemeProvider>
        ));

        const toggle = () => [...document.querySelectorAll('label')]
            .find(label => label.textContent.includes('Keep Copies for Latecomers'))
            .querySelector('input');
        expect(toggle().checked).toBe(false);

        await act(async () => emitter.emit('roomSettings', { keepCopies: true }));
        expect(toggle().checked).toBe(true);

        updateRoomSettings.mockResolvedValueOnce({ keepCopies: false });
        await act(async () => toggle().click());
        expect(updateRoomSettings).toHaveBeenCalledWith({ keepCopies: false });
        expect(toggle().checked).toBe(false);

        await act(async () => root.unmount());
        div.remove();
    });
});
