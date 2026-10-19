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
        emit: () => {},
    },
    client: { peerId: 'me' },
    peers: { items: [] },
    service: { update: () => {} },
    metadata: {
        createMetadataSummary: () => ([
            { key: 'Title XMP', value: 'Harbor light' },
            { key: 'x-Description', value: 'Misty morning on the dock.' },
            { key: 'Rating XMP', value: 5 },
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
        expect(text).toContain('Harbor light');
        expect(text).toContain('Misty morning on the dock.');
        expect(text).toContain('Fujifilm X-T5');
        expect(text).toContain('Camera');
        expect(text).toContain('All metadata');
        expect(text).toContain('FUJIFILM');
        expect(text).toContain('Make');
        // Catalog fields lead, ahead of the technical details
        expect(text.indexOf('Harbor light')).toBeLessThan(text.indexOf('Misty morning on the dock.'));
        expect(text.indexOf('Misty morning on the dock.')).toBeLessThan(text.indexOf('Fujifilm X-T5'));
        // Everything is visible without expanding anything
        expect(document.body.querySelector('details').open).toBe(true);

        await act(async () => {
            root.unmount();
        });
        div.remove();
    });

    it('shows video technical details when gallery metadata updates arrive', async () => {
        const videoTile = {
            infoHash: 'vid123',
            fileName: 'clip.mp4',
            fileSize: '12 MB',
            isVideo: true,
            isImage: false,
            torrentFile: { length: 12_000_000, createReadStream: () => ({}) },
            owners: [],
        };

        const photosListeners = [];
        const videoMaster = {
            ...master,
            emitter: {
                on: (event, handler) => {
                    if (event === 'photos') photosListeners.push(handler);
                },
                removeListener: (event, handler) => {
                    if (event === 'photos') {
                        const index = photosListeners.indexOf(handler);
                        if (index >= 0) photosListeners.splice(index, 1);
                    }
                },
                emit: () => {},
            },
            metadata: {
                createMetadataSummary: () => ([
                    {
                        key: 'format',
                        value: { duration: '1 min', codec: 'h264', container: 'MP4' },
                    },
                ]),
            },
        };

        const div = document.createElement('div');
        document.body.appendChild(div);
        const root = createRoot(div);

        await act(async () => {
            root.render(
                <ThemeProvider theme={createAppTheme('dark')}>
                    <PhotoViewer
                        master={videoMaster}
                        tiles={[videoTile]}
                        index={0}
                        onClose={() => {}}
                        onIndexChange={() => {}}
                    />
                </ThemeProvider>
            );
        });

        await act(async () => {
            photosListeners.forEach(handler => handler({
                type: 'update',
                item: [{
                    infoHash: 'vid123',
                    hasMetadata: true,
                    metadata: {
                        format: { duration: '1 min', codec: 'h264', container: 'MP4' },
                    },
                }],
            }));
        });

        expect(document.body.textContent).toContain('Codec');
        expect(document.body.textContent).toContain('h264');

        await act(async () => {
            root.unmount();
        });
        div.remove();
    });
});
