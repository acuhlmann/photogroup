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

    it('has a Remove button only when given onRemove, and closes after it', async () => {
        const div = document.createElement('div');
        document.body.appendChild(div);
        const root = createRoot(div);
        const view = props => (
            <ThemeProvider theme={createAppTheme('dark')}>
                <PhotoViewer master={master} tiles={[tile]} index={0}
                    onClose={() => {}} onIndexChange={() => {}} {...props} />
            </ThemeProvider>
        );

        await act(async () => root.render(view()));
        expect(document.body.querySelector('[aria-label="Remove harbor.jpg"]')).toBeNull();

        const onRemove = vi.fn();
        const onClose = vi.fn();
        await act(async () => root.render(view({ onRemove, onClose })));
        await act(async () => document.body.querySelector('[aria-label="Remove harbor.jpg"]').click());
        expect(onRemove).toHaveBeenCalledWith(tile);
        expect(onClose).toHaveBeenCalled();

        // A failed remove keeps the viewer open.
        const failing = vi.fn().mockResolvedValue(false);
        const stay = vi.fn();
        await act(async () => root.render(view({ onRemove: failing, onClose: stay })));
        await act(async () => document.body.querySelector('[aria-label="Remove harbor.jpg"]').click());
        expect(failing).toHaveBeenCalled();
        expect(stay).not.toHaveBeenCalled();

        await act(async () => root.unmount());
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

        const button = document.body.querySelector('[data-testid="replace-original"]');
        expect(button.textContent).toContain('Save to a folder…');
        expect(button.getAttribute('title')).toContain('Pick the folder this goes into');

        await act(async () => {
            button.click();
        });

        expect(window.showSaveFilePicker).toHaveBeenCalledWith(expect.objectContaining({
            suggestedName: 'harbor.jpg',
            id: 'photogroup-replace',
        }));
        expect(stream.write).toHaveBeenCalled();
        expect(button.textContent).toContain('Saved');

        await act(async () => {
            root.unmount();
        });
        div.remove();
    });

    it('shows the photo alone with a one-line caption when details are in the list', async () => {
        const div = document.createElement('div');
        document.body.appendChild(div);
        const root = createRoot(div);
        await act(async () => {
            root.render(
                <ThemeProvider theme={createAppTheme('dark')}>
                    <PhotoViewer master={master} tiles={[tile]} index={0} details={false}
                        onClose={() => {}} onIndexChange={() => {}} />
                </ThemeProvider>
            );
        });
        expect(document.body.querySelector('[data-testid="viewer-details"]')).toBeNull();
        expect([...document.body.querySelectorAll('button')].some(button => button.textContent === 'Details')).toBe(false);
        expect(document.body.querySelector('[data-testid="viewer-caption"]').textContent).toBe('Harbor light · Fujifilm X-T5');
        await act(async () => root.unmount());
        div.remove();
    });

    it('shows a copy the size of the screen, and the whole photo once zoomed in', async () => {
        // A 50 MP photo: drawn whole on a big phone it blinked out whenever the browser let go of it.
        vi.stubGlobal('Image', class {
            set src(value) {
                this.naturalWidth = 8160;
                this.naturalHeight = 6120;
                setTimeout(() => this.onload && this.onload());
            }
        });
        const make = vi.fn(async () => ({ width: 2731, height: 2048, close: () => {} }));
        vi.stubGlobal('createImageBitmap', make);
        HTMLCanvasElement.prototype.getContext = () => ({ drawImage: () => {} });
        HTMLCanvasElement.prototype.toBlob = function (done) { done(new Blob(['x'], { type: 'image/jpeg' })); };
        const createUrl = URL.createObjectURL;
        const revokeUrl = URL.revokeObjectURL;
        URL.createObjectURL = vi.fn(() => 'blob:screen');
        URL.revokeObjectURL = vi.fn();
        const viewport = new EventTarget();
        viewport.scale = 1;
        vi.stubGlobal('visualViewport', viewport);
        const big = { ...tile, infoHash: 'big50mp', previewUrl: 'blob:preview' };

        const div = document.createElement('div');
        document.body.appendChild(div);
        const root = createRoot(div);
        await act(async () => {
            root.render(
                <ThemeProvider theme={createAppTheme('dark')}>
                    <PhotoViewer master={master} tiles={[big]} index={0} details={false}
                        onClose={() => {}} onIndexChange={() => {}} />
                </ThemeProvider>
            );
        });
        await act(async () => { await new Promise(resolve => setTimeout(resolve, 20)); });
        const photo = () => document.body.querySelector('[data-testid="viewer-photo"]');
        expect(make).toHaveBeenCalledTimes(1);
        expect(photo().getAttribute('src')).toBe('blob:screen');
        // The share's preview stays behind it, so an undrawn moment is never black.
        expect(photo().style.backgroundImage).toContain('blob:preview');
        const element = photo();

        await act(async () => {
            viewport.scale = 2.5;
            viewport.dispatchEvent(new Event('resize'));
        });
        expect(photo()).toBe(element);
        expect(photo().getAttribute('src')).toBe('blob:harbor');
        expect(photo().style.backgroundImage).toContain('blob:screen');
        // Zoomed out again, that photo stays whole: no second swap.
        await act(async () => {
            viewport.scale = 1;
            viewport.dispatchEvent(new Event('resize'));
        });
        expect(photo().getAttribute('src')).toBe('blob:harbor');

        await act(async () => root.unmount());
        div.remove();
        vi.unstubAllGlobals();
        URL.createObjectURL = createUrl;
        URL.revokeObjectURL = revokeUrl;
    });

    it('puts nothing back behind a see-through photo once it is drawn, even when its copy comes later', async () => {
        vi.stubGlobal('Image', class {
            set src(value) {
                this.naturalWidth = 8000;
                this.naturalHeight = 6000;
                setTimeout(() => this.onload && this.onload());
            }
        });
        let finishCopy;
        vi.stubGlobal('createImageBitmap', () => new Promise(resolve => { finishCopy = resolve; }));
        HTMLCanvasElement.prototype.getContext = () => ({ drawImage: () => {} });
        HTMLCanvasElement.prototype.toBlob = function (done) { done(new Blob(['x'], { type: 'image/webp' })); };
        const createUrl = URL.createObjectURL;
        const revokeUrl = URL.revokeObjectURL;
        URL.createObjectURL = vi.fn(() => 'blob:screen-png');
        URL.revokeObjectURL = vi.fn();
        // Zoomed in from the start: the whole photo is asked for before its copy is made.
        const viewport = new EventTarget();
        viewport.scale = 2;
        vi.stubGlobal('visualViewport', viewport);
        const png = { ...tile, infoHash: 'clear-png', fileType: 'image/png', previewUrl: 'blob:preview-png',
            elem: new Blob(['png'], { type: 'image/png' }) };

        const div = document.createElement('div');
        document.body.appendChild(div);
        const root = createRoot(div);
        await act(async () => {
            root.render(
                <ThemeProvider theme={createAppTheme('dark')}>
                    <PhotoViewer master={master} tiles={[png]} index={0} details={false}
                        onClose={() => {}} onIndexChange={() => {}} />
                </ThemeProvider>
            );
        });
        await act(async () => { await new Promise(resolve => setTimeout(resolve, 20)); });
        const photo = () => document.body.querySelector('[data-testid="viewer-photo"]');
        expect(photo().getAttribute('src')).toBe('blob:harbor');
        expect(photo().style.backgroundImage).toContain('blob:preview-png');
        // The whole photo is drawn: nothing shows behind its see-through parts.
        await act(async () => { photo().dispatchEvent(new Event('load')); });
        expect(photo().style.backgroundImage).toBe('');
        // The screen copy comes in afterwards; it must not go behind the photo.
        await act(async () => {
            finishCopy({ width: 2048, height: 1536, close: () => {} });
            await new Promise(resolve => setTimeout(resolve, 20));
        });
        expect(photo().getAttribute('src')).toBe('blob:harbor');
        expect(photo().style.backgroundImage).toBe('');

        await act(async () => root.unmount());
        div.remove();
        vi.unstubAllGlobals();
        URL.createObjectURL = createUrl;
        URL.revokeObjectURL = revokeUrl;
    });
});
