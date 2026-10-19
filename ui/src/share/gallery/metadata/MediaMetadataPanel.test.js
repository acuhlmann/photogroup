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

        await act(async () => button(div, 'Add a title').click());
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

    it('prompts for a missing description in place and shows who edited last', async () => {
        const onSaveDetails = vi.fn().mockResolvedValue({});
        const tile = { isImage: true, infoHash: 'b', details: { title: 'Pier', editedBy: { name: 'Bob' }, editedAt: Date.now() } };
        const { div, root } = await renderPanel({ summary: [{ key: 'x-Camera', value: 'Pixel 9' }], tile, onSaveDetails });

        expect(div.querySelector('[data-testid="details-edited-by"]').textContent).toContain('Edited by Bob');
        // Editable fields are prompted for in the hero, not listed as "Not set"
        expect(div.querySelector('[data-testid="metadata-missing"]').textContent).not.toContain('Description');
        await act(async () => button(div, 'Add a description').click());
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
        await act(async () => button(div, 'Add a title').click());
        await act(async () => button(div, '2 stars').click());
        await act(async () => button(div, 'Save for everyone').click());
        expect(div.querySelector('[role="alert"]').textContent).toContain('still being shared');
        expect(button(div, 'Save for everyone')).toBeTruthy();
        await act(async () => root.unmount());
    });

    it('saves a rating with one tap and clears it with a second', async () => {
        const onSaveDetails = vi.fn().mockResolvedValue({});
        const tile = { isImage: true, infoHash: 'r', details: { rating: 3 } };
        const { div, root } = await renderPanel({ summary: [], tile, onSaveDetails });

        await act(async () => button(div, '5 stars').click());
        expect(onSaveDetails).toHaveBeenLastCalledWith({ rating: 5 });
        await act(async () => button(div, '3 stars').click());
        expect(onSaveDetails).toHaveBeenLastCalledWith({ rating: 0 });

        onSaveDetails.mockRejectedValueOnce(new Error('Offline'));
        await act(async () => button(div, '1 star').click());
        expect(div.querySelector('[role="alert"]').textContent).toBe('Offline');
        await act(async () => root.unmount());
    });

    it('stays read-only without a save handler', async () => {
        const { div, root } = await renderPanel({ summary: [{ key: 'Title XMP', value: 'X' }], tile: { isImage: true } });
        expect(button(div, 'Edit title, description and rating')).toBeUndefined();
        expect(button(div, 'Add a title')).toBeUndefined();
        expect(button(div, '3 stars')).toBeUndefined();
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

    it('shows where a photo was taken with a map, the place and map links', async () => {
        const fetchMock = vi.fn().mockResolvedValue({
            ok: true,
            json: async () => ({ address: { suburb: 'Huangpu', city: 'Shanghai', country: 'China' } }),
        });
        vi.stubGlobal('fetch', fetchMock);
        const summary = [{ key: 'x-Location', value: { lat: 31.2304, long: 121.4737, altitude: 12, direction: 123.4, accuracy: 5 } }];
        const { div, root } = await renderPanel({ summary, tile: { isImage: true, infoHash: 'g' } });
        await act(async () => { await new Promise(resolve => setTimeout(resolve, 0)); });

        const card = div.querySelector('[data-testid="location-card"]');
        expect(card.textContent).toContain('Huangpu, Shanghai, China');
        expect(card.textContent).toContain('31°13′49.4″N 121°28′25.3″E');
        expect(card.textContent).toContain('Altitude 12 m');
        expect(card.textContent).toContain('Facing 123° SE');
        expect(card.textContent).toContain('Accuracy ±5 m');
        const hrefs = [...card.querySelectorAll('a')].map(a => a.getAttribute('href'));
        expect(hrefs).toContain('https://www.google.com/maps/search/?api=1&query=31.230400,121.473700');
        expect(hrefs.some(href => href.startsWith('https://uri.amap.com/marker?position=121.473700,31.230400')
            && href.includes('coordinate=wgs84'))).toBe(true);
        expect(card.querySelectorAll('img[src^="https://tile.openstreetmap.org/14/"]').length).toBeGreaterThan(0);
        expect(fetchMock.mock.calls[0][0]).toContain('nominatim.openstreetmap.org/reverse?format=jsonv2&zoom=14&lat=31.2304&lon=121.4737');
        vi.unstubAllGlobals();
        await act(async () => root.unmount());
    });
});
