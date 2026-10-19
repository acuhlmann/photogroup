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
    });
});
