import React, { act } from 'react';
import { createRoot } from 'react-dom/client';
import { afterEach, describe, expect, it, vi } from 'vitest';
import MediaStage from './MediaStage';

describe('MediaStage', () => {
    afterEach(() => vi.unstubAllGlobals());

    // Simple mode drew the whole 50 MP photo and took the copy from behind it
    // once decoded: on an unfolded foldable it blinked black on each swipe.
    it('shows a copy the size of the screen and keeps the small copy behind it', async () => {
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
        const tile = { infoHash: 'simple50', tileKey: 'simple50', fileName: 'big.jpg', isImage: true, loading: false,
            img: 'blob:whole', previewUrl: 'blob:preview', elem: new Blob(['photo'], { type: 'image/jpeg' }) };

        const div = document.createElement('div');
        document.body.appendChild(div);
        const root = createRoot(div);
        await act(async () => root.render(<MediaStage tile={tile} onStep={() => {}} />));
        await act(async () => { await new Promise(resolve => setTimeout(resolve, 20)); });
        const photo = div.querySelector('img');
        expect(make).toHaveBeenCalledTimes(1);
        expect(photo.getAttribute('src')).toBe('blob:screen');
        expect(photo.style.backgroundImage).toContain('blob:preview');
        await act(async () => { photo.dispatchEvent(new Event('load')); });
        expect(div.querySelector('img').style.backgroundImage).toContain('blob:preview');

        await act(async () => root.unmount());
        div.remove();
        URL.createObjectURL = createUrl;
        URL.revokeObjectURL = revokeUrl;
    });
});
