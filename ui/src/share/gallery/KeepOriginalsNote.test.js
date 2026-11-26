import React from 'react';
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { createRoot } from 'react-dom/client';
import { act } from 'react';
import KeepOriginalsNote from './KeepOriginalsNote';

const ANDROID = 'Mozilla/5.0 (Linux; Android 15; Pixel 9) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/140.0.0.0 Mobile Safari/537.36';
const IPHONE = 'Mozilla/5.0 (iPhone; CPU iPhone OS 18_6 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/18.6 Mobile/15E148 Safari/604.1';
const DESKTOP = 'Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/140.0.0.0 Safari/537.36';

/** A working localStorage; the shared test setup stubs one that stores nothing. */
function memoryStorage() {
    const items = new Map();
    return {
        getItem: key => (items.has(key) ? items.get(key) : null),
        setItem: (key, value) => items.set(key, String(value)),
        removeItem: key => items.delete(key),
    };
}

describe('KeepOriginalsNote', () => {
    let userAgent;
    beforeEach(() => {
        userAgent = vi.spyOn(window.navigator, 'userAgent', 'get');
        vi.stubGlobal('localStorage', memoryStorage());
    });
    afterEach(() => userAgent.mockRestore());

    async function render() {
        const div = document.createElement('div');
        const root = createRoot(div);
        await act(async () => root.render(<KeepOriginalsNote />));
        return { div, root };
    }

    it('tells Android users how to keep locations, until they dismiss it', async () => {
        userAgent.mockReturnValue(ANDROID);
        const { div, root } = await render();
        const note = div.querySelector('[data-testid="android-location-note"]');
        expect(note.textContent).toContain('select Material Files');
        expect(note.textContent).toContain('share the zip');
        expect(note.querySelector('a').getAttribute('href')).toContain('me.zhanghai.android.files');

        const gotIt = Array.from(note.querySelectorAll('button')).find(button => button.textContent === 'Got it');
        await act(async () => gotIt.click());
        expect(div.querySelector('[data-testid="android-location-note"]')).toBeNull();
        await act(async () => root.unmount());

        const again = await render();
        expect(again.div.querySelector('[data-testid="android-location-note"]')).toBeNull();
        await act(async () => again.root.unmount());
    });

    it('tells iPhone users how to keep the location and share original clips', async () => {
        userAgent.mockReturnValue(IPHONE);
        const { div, root } = await render();
        const note = div.querySelector('[data-testid="iphone-originals-note"]');
        expect(note.textContent).toContain('tap Options and turn on Location');
        expect(note.textContent).toContain('Save to Files');
        expect(note.textContent).toContain('Choose File');
        expect(note.querySelector('a')).toBeNull();

        const gotIt = Array.from(note.querySelectorAll('button')).find(button => button.textContent === 'Got it');
        await act(async () => gotIt.click());
        expect(div.querySelector('[data-testid="iphone-originals-note"]')).toBeNull();
        await act(async () => root.unmount());
    });

    it('stays out of the way everywhere else', async () => {
        userAgent.mockReturnValue(DESKTOP);
        const { div, root } = await render();
        expect(div.innerHTML).toBe('');
        await act(async () => root.unmount());
    });
});
