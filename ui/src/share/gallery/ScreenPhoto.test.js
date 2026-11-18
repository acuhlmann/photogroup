import React, { act } from 'react';
import { createRoot } from 'react-dom/client';
import { afterEach, describe, expect, it, vi } from 'vitest';
import ScreenPhoto from './ScreenPhoto';

async function show(tile) {
    const div = document.createElement('div');
    document.body.appendChild(div);
    const root = createRoot(div);
    await act(async () => root.render(<ScreenPhoto tile={tile} />));
    await act(async () => { await new Promise(resolve => setTimeout(resolve, 20)); });
    return { div, root };
}

describe('ScreenPhoto', () => {
    afterEach(() => vi.unstubAllGlobals());

    it('shows a GIF as it is, so it still moves', async () => {
        const make = vi.fn(async () => ({ width: 10, height: 10, close: () => {} }));
        vi.stubGlobal('createImageBitmap', make);
        const gif = { infoHash: 'gif1', isImage: true, fileType: 'image/gif', img: 'blob:gif',
            elem: new Blob(['gif'], { type: 'image/gif' }) };
        const { div, root } = await show(gif);
        expect(div.querySelector('img').getAttribute('src')).toBe('blob:gif');
        expect(make).not.toHaveBeenCalled();
        await act(async () => root.unmount());
        div.remove();
    });

    it('shows a photo still being shared from this device', async () => {
        const sharing = { infoHash: 'seed1', isImage: true, loading: true, img: 'blob:seed' };
        const { div, root } = await show(sharing);
        expect(div.querySelector('img').getAttribute('src')).toBe('blob:seed');
        await act(async () => root.unmount());
        div.remove();
    });
});
