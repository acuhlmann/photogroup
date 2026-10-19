import React, { act } from 'react';
import { createRoot } from 'react-dom/client';
import { afterEach, describe, expect, it, vi } from 'vitest';
import EventEmitter from 'eventemitter3';
import RenderContent from '../RenderContent';

describe('RenderContent image decoding', () => {
    let root;
    let container;
    afterEach(() => {
        act(() => root.unmount());
        container.remove();
    });

    function setup() {
        const master = { emitter: new EventEmitter(), metadata: { readMetadata: vi.fn() } };
        const tile = { infoHash: 'photo', isImage: true, img: 'blob:first', previewUrl: 'blob:preview', fileName: 'photo.jpg' };
        container = document.createElement('div');
        document.body.appendChild(container);
        root = createRoot(container);
        act(() => root.render(<RenderContent tile={tile} master={master} />));
        const image = () => container.querySelector('img');
        return {
            image,
            replace: src => act(() => root.render(<RenderContent tile={{ ...tile, img: src }} master={master} />)),
        };
    }

    function load(img) {
        const pending = Promise.withResolvers();
        img.decode = vi.fn(() => pending.promise);
        act(() => img.dispatchEvent(new Event('load')));
        return pending;
    }

    it('keeps the preview until decoding succeeds and restores it for a replacement', async () => {
        const view = setup();
        const first = load(view.image());
        expect(view.image().style.backgroundImage).toContain('blob:preview');
        await act(async () => first.resolve());
        expect(view.image().style.backgroundImage).toBe('');

        view.replace('blob:replacement');
        expect(view.image().style.backgroundImage).toContain('blob:preview');
        const replacement = load(view.image());
        await act(async () => replacement.resolve());
        expect(view.image().style.backgroundImage).toBe('');
    });

    it('keeps the preview after a rejected decode', async () => {
        const view = setup();
        const pending = load(view.image());
        await act(async () => pending.reject(new Error('decode failed')));
        expect(view.image().style.backgroundImage).toContain('blob:preview');
    });

    it.each(['resolve', 'reject'])('ignores a stale decode that will %s after the image changes', async outcome => {
        const view = setup();
        const first = load(view.image());
        view.replace('blob:replacement');
        const replacement = load(view.image());

        await act(async () => first[outcome](new Error('stale decode')));
        expect(view.image().style.backgroundImage).toContain('blob:preview');
        await act(async () => replacement.resolve());
        expect(view.image().style.backgroundImage).toBe('');
    });

    it('ignores the original decode when the same URL is selected again', async () => {
        const view = setup();
        const first = load(view.image());
        view.replace('blob:replacement');
        view.replace('blob:first');
        await act(async () => first.resolve());
        expect(view.image().style.backgroundImage).toContain('blob:preview');
    });
});
