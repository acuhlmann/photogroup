import React, { act } from 'react';
import { describe, it, expect, vi, afterEach } from 'vitest';
import { createRoot } from 'react-dom/client';
import { MapLoadBoundary } from '../ShareCanvas';

function Broken() {
    throw new Error('Failed to fetch dynamically imported module');
}

async function show(element) {
    const div = document.createElement('div');
    document.body.appendChild(div);
    const root = createRoot(div);
    await act(async () => root.render(element));
    return div;
}

const button = (div, name) => [...div.querySelectorAll('button')].find(item => item.textContent === name);

describe('MapLoadBoundary', () => {
    afterEach(() => vi.restoreAllMocks());

    it('keeps the app and offers a reload when the map cannot load', async () => {
        vi.spyOn(console, 'error').mockImplementation(() => {});
        const div = await show(<MapLoadBoundary><Broken /></MapLoadBoundary>);

        expect(div.textContent).toContain('Cannot load the map. Check your connection.');
        expect(button(div, 'Reload the page')).toBeTruthy();
    });

    it('shows the map when it loads', async () => {
        const div = await show(<MapLoadBoundary><p>map</p></MapLoadBoundary>);
        expect(div.textContent).toBe('map');
    });
});
