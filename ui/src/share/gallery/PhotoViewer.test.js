import React, { act } from 'react';
import { createRoot } from 'react-dom/client';
import { ThemeProvider } from '@mui/material/styles';
import { createAppTheme } from '../../theme';
import PhotoViewer from './PhotoViewer';

const tile = {
    infoHash: 'abc123',
    fileName: 'harbor.jpg',
    fileSize: '4.2 MB',
    isImage: true,
    img: 'blob:harbor',
    elem: new Blob(['photo'], { type: 'image/jpeg' }),
    hasMetadata: true,
    metadata: { Make: 'FUJIFILM' },
    owners: [],
};

const master = {
    emitter: {
        on: () => {},
        removeListener: () => {},
    },
    client: { peerId: 'me' },
    peers: { items: [] },
    service: { update: () => {} },
    metadata: {
        createMetadataSummary: () => ([
            { key: 'x-Camera', value: 'Fujifilm X-T5' },
            { key: 'DateTimeOriginal', value: '14:2 Oct 15 2026' },
            { key: 'Make', value: 'FUJIFILM' },
        ]),
    },
};

describe('PhotoViewer', () => {
    it('shows the file size, a save control, and the photo details', async () => {
        const div = document.createElement('div');
        document.body.appendChild(div);
        const root = createRoot(div);

        await act(async () => {
            root.render(
                <ThemeProvider theme={createAppTheme('dark')}>
                    <PhotoViewer
                        master={master}
                        tiles={[tile]}
                        index={0}
                        onClose={() => {}}
                        onIndexChange={() => {}}
                    />
                </ThemeProvider>
            );
        });

        const text = document.body.textContent;
        const save = [...document.body.querySelectorAll('button')].find(button =>
            button.textContent.includes('Save · 4.2 MB')
        );

        expect(save).toBeTruthy();
        expect(text).toContain('4.2 MB');
        expect(text).toContain('Fujifilm X-T5');
        expect(text).toContain('Camera');
        expect(text).toContain('More');
        expect(text).toContain('FUJIFILM');
        expect(text).toContain('Make');

        await act(async () => {
            root.unmount();
        });
        div.remove();
    });
});
