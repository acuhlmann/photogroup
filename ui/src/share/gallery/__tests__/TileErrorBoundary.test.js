import React from 'react';
import { describe, it, expect, vi } from 'vitest';
import { createRoot } from 'react-dom/client';
import { act } from 'react';
import TileErrorBoundary from '../TileErrorBoundary';

function Boom() {
    throw new Error('boom');
}

describe('TileErrorBoundary', () => {
    it('shows a fallback, then recovers when the tile finishes loading', async () => {
        vi.spyOn(console, 'error').mockImplementation(() => {});
        const div = document.createElement('div');
        const root = createRoot(div);

        await act(async () => {
            root.render(<TileErrorBoundary fileName="a.jpg" resetKey={true}><Boom /></TileErrorBoundary>);
        });
        expect(div.textContent).toContain('Could not display a.jpg');

        await act(async () => {
            root.render(<TileErrorBoundary fileName="a.jpg" resetKey={false}><span>photo</span></TileErrorBoundary>);
        });
        expect(div.textContent).toBe('photo');

        await act(async () => root.unmount());
        console.error.mockRestore?.();
    });

    // Regression guard for the gallery flicker: an entrance animation restarts
    // whenever the browser re-inserts its node, and a fade that begins at
    // opacity 0 hides every tile it moves. Re-ordering the gallery did exactly
    // that, so the wrapper must carry no animation of its own.
    it('carries no entrance animation', async () => {
        const div = document.createElement('div');
        const root = createRoot(div);

        await act(async () => {
            root.render(<TileErrorBoundary fileName="a.jpg"><span>photo</span></TileErrorBoundary>);
        });
        expect(div.firstChild.className).toBe('');
        expect(div.firstChild.getAttribute('style') || '').not.toMatch(/animation/i);

        await act(async () => root.unmount());
    });

    // The wrapper has to survive the loading -> content swap: replacing it would
    // rebuild the tile's DOM and re-decode the photo behind it.
    it('keeps the same wrapper node when the tile re-renders', async () => {
        const div = document.createElement('div');
        const root = createRoot(div);

        await act(async () => {
            root.render(<TileErrorBoundary fileName="a.jpg"><span>loading</span></TileErrorBoundary>);
        });
        const wrapper = div.firstChild;

        await act(async () => {
            root.render(<TileErrorBoundary fileName="a.jpg"><span>photo</span></TileErrorBoundary>);
        });
        expect(div.firstChild).toBe(wrapper);

        await act(async () => root.unmount());
    });
});
