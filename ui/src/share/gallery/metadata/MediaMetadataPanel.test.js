import React from 'react';
import { describe, it, expect, vi } from 'vitest';
import { createRoot } from 'react-dom/client';
import { act } from 'react';
import { ThemeProvider } from '@mui/material/styles';
import { createAppTheme } from '../../../theme';
import MediaMetadataPanel, { shortPlatform } from './MediaMetadataPanel';

function setInput(input, value) {
    const setter = Object.getOwnPropertyDescriptor(Object.getPrototypeOf(input), 'value').set;
    setter.call(input, value);
    input.dispatchEvent(new Event('input', { bubbles: true }));
}

async function renderPanel(props) {
    const div = document.createElement('div');
    document.body.appendChild(div);
    const root = createRoot(div);
    await act(async () => {
        root.render(<ThemeProvider theme={createAppTheme('dark')}><MediaMetadataPanel {...props} /></ThemeProvider>);
    });
    return { div, root };
}

const button = (div, text) => [...div.querySelectorAll('button')].find(b => b.textContent.includes(text) || b.getAttribute('aria-label') === text);

describe('MediaMetadataPanel shared editing', () => {
    it('lets anyone add a title, description and rating and sends only what changed', async () => {
        const onSaveDetails = vi.fn().mockResolvedValue({});
        const summary = [{ key: 'x-Camera', value: 'Pixel 9' }];
        const { div, root } = await renderPanel({ summary, tile: { isImage: true, infoHash: 'a' }, onSaveDetails });

        await act(async () => button(div, 'Add a title, description or rating').click());
        const [title, description] = div.querySelectorAll('input[type="text"], textarea');
        await act(async () => setInput(title, '  Harbour light '));
        await act(async () => button(div, '4 stars').click());
        await act(async () => button(div, 'Save for everyone').click());

        expect(onSaveDetails).toHaveBeenCalledWith({ title: 'Harbour light', rating: 4 });
        expect(description).toBeTruthy();
        // Editor closes after a successful save
        expect(button(div, 'Save for everyone')).toBeUndefined();
        await act(async () => root.unmount());
    });

    it('opens the editor from the quiet "Not set" line and shows who edited last', async () => {
        const onSaveDetails = vi.fn().mockResolvedValue({});
        const tile = { isImage: true, infoHash: 'b', details: { title: 'Pier', editedBy: { name: 'Bob' }, editedAt: Date.now() } };
        const { div, root } = await renderPanel({ summary: [{ key: 'x-Camera', value: 'Pixel 9' }], tile, onSaveDetails });

        expect(div.querySelector('[data-testid="details-edited-by"]').textContent).toContain('Edited by Bob');
        const missing = div.querySelector('[data-testid="metadata-missing"]');
        await act(async () => [...missing.querySelectorAll('button')].find(b => b.textContent === 'Description').click());
        expect(document.activeElement.tagName).toBe('TEXTAREA');
        // Nothing changed means no request
        await act(async () => button(div, 'Save for everyone').click());
        expect(onSaveDetails).not.toHaveBeenCalled();
        await act(async () => root.unmount());
    });

    it('keeps the editor open and explains when the photo is not on the server yet', async () => {
        const error = Object.assign(new Error('Photo not found'), { status: 404 });
        const onSaveDetails = vi.fn().mockRejectedValue(error);
        const { div, root } = await renderPanel({ summary: [], tile: { isImage: true, infoHash: 'c' }, onSaveDetails });
        await act(async () => button(div, 'Add a title, description or rating').click());
        await act(async () => button(div, '2 stars').click());
        await act(async () => button(div, 'Save for everyone').click());
        expect(div.querySelector('[role="alert"]').textContent).toContain('still being shared');
        expect(button(div, 'Save for everyone')).toBeTruthy();
        await act(async () => root.unmount());
    });

    it('stays read-only without a save handler', async () => {
        const { div, root } = await renderPanel({ summary: [{ key: 'Title XMP', value: 'X' }], tile: { isImage: true } });
        expect(button(div, 'Edit title, description and rating')).toBeUndefined();
        await act(async () => root.unmount());
    });

    it('names editors without a nickname by browser and OS, and you as you', async () => {
        expect(shortPlatform('Chrome Mobile 141.0.0.0 on Google Pixel 9 Pro Fold (Android 16)')).toBe('Chrome on Android');
        expect(shortPlatform('Chrome 141.0.0.0 (headless) on Linux 64-bit')).toBe('Chrome on Linux');
        expect(shortPlatform('Safari 18.2 on Apple iPhone (iOS 18.2)')).toBe('Safari on iOS');
        const tile = { isImage: true, infoHash: 'd', details: { title: 'T', editedBy: { peerId: 'me', platform: 'x' }, editedAt: Date.now() } };
        const { div, root } = await renderPanel({ summary: [], tile, onSaveDetails: vi.fn(), myPeerId: 'me' });
        expect(div.querySelector('[data-testid="details-edited-by"]').textContent).toContain('Edited by you');
        await act(async () => root.unmount());
    });
});
