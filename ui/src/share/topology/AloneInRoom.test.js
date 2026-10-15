import React, { act } from 'react';
import { createRoot } from 'react-dom/client';
import { ThemeProvider } from '@mui/material/styles';
import { createAppTheme } from '../../theme';
import AloneInRoom from './AloneInRoom';

describe('AloneInRoom', () => {
    it('explains the empty map and invites someone', async () => {
        const div = document.createElement('div');
        document.body.appendChild(div);
        const root = createRoot(div);
        let invited = false;

        await act(async () => {
            root.render(
                <ThemeProvider theme={createAppTheme('light')}>
                    <AloneInRoom onInvite={() => { invited = true; }} />
                </ThemeProvider>
            );
        });

        expect(document.body.textContent).toContain("You're the only one here");
        expect(document.body.textContent).toContain('directly, through a network, or over a relay');
        expect(document.body.textContent).not.toContain('Create a room');

        const button = [...document.body.querySelectorAll('button')].find(item =>
            item.textContent.includes('Invite someone')
        );
        expect(button).toBeTruthy();
        await act(async () => {
            button.click();
        });
        expect(invited).toBe(true);

        await act(async () => {
            root.unmount();
        });
        div.remove();
    });
});
