import React, { act } from 'react';
import { createRoot } from 'react-dom/client';
import { ThemeProvider } from '@mui/material/styles';
import { createAppTheme } from '../../theme';
import PhotoViewer from './PhotoViewer';
import { clearOriginalFiles } from './replaceOriginal';

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
            { key: 'Flash', value: 'Flash did not fire, compulsory flash mode' },
            { key: 'XResolution', value: '72' },
        ]),
    },
};

describe('PhotoViewer', () => {
    afterEach(() => {
        delete window.showSaveFilePicker;
        clearOriginalFiles();
    });

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
        expect(text).not.toContain('Replace original');
        expect(text).toContain('4.2 MB');
        expect(text).toContain('Harbor light');
        expect(text).toContain('Misty morning on the dock.');
        expect(text).toContain('Fujifilm X-T5');
        expect(text).toContain('Camera');
        // Catalog fields lead, ahead of the technical details
        expect(text.indexOf('Harbor light')).toBeLessThan(text.indexOf('Misty morning on the dock.'));
        expect(text.indexOf('Misty morning on the dock.')).toBeLessThan(text.indexOf('Fujifilm X-T5'));
        // The rest is one tap away, in plain words; Make is already in Camera
        expect(document.body.querySelector('details').open).toBe(false);
        expect(text).toContain('All metadata');
        expect(text).toContain('No flash');
        expect(text).not.toContain('FUJIFILM');
        expect(text).not.toContain('XResolution');
        // Important fields that are not set are named quietly, last
        const missing = document.body.querySelector('[data-testid="metadata-missing"]').textContent;
        expect(missing).toContain('Location');
        expect(missing).not.toContain('Title');
        expect(text.trim().endsWith(missing) || text.indexOf(missing) > text.indexOf('All metadata')).toBe(true);

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

    it('replaces the original file when the browser can write it', async () => {
        const stream = {
            write: vi.fn().mockResolvedValue(undefined),
            close: vi.fn().mockResolvedValue(undefined),
            abort: vi.fn(),
        };
        window.showSaveFilePicker = vi.fn().mockResolvedValue({
            kind: 'file',
            createWritable: vi.fn().mockResolvedValue(stream),
        });

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

        // A photo received from someone else has no original on this device,
        // so the honest name for this is choosing where the save goes.
        const button = document.body.querySelector('[data-testid="replace-original"]');
        expect(button.textContent).toContain('Choose where to save…');
        expect(document.body.textContent).toContain('Pick the folder this goes into');

        await act(async () => {
            button.click();
        });

        expect(window.showSaveFilePicker).toHaveBeenCalledWith(expect.objectContaining({
            suggestedName: 'harbor.jpg',
            id: 'photogroup-replace',
        }));
        expect(stream.write).toHaveBeenCalled();
        expect(button.textContent).toContain('Replaced');

        await act(async () => {
            root.unmount();
        });
        div.remove();
    });
});
