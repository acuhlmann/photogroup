import React from 'react';
import { describe, it, expect, vi } from 'vitest';
import { createRoot } from 'react-dom/client';
import { act } from 'react';
import { ThemeProvider } from '@mui/material/styles';
import { createAppTheme } from '../../theme';
import RoomMap, { clusterPins, fitView } from './RoomMap';
import { tilePosition } from './metadata/geo';

const item = (name, lat, long) => ({ tile: { infoHash: name, fileName: name, isImage: true }, location: { lat, long }, label: name });
const ZURICH = item('lake.jpg', 47.3667, 8.5417);
const ZURICH_OLD_TOWN = item('altstadt.jpg', 47.3717, 8.5423);
const SHANGHAI = item('bund.jpg', 31.24, 121.4905);

describe('RoomMap', () => {
    it('fits every photo into the map', () => {
        const view = fitView([ZURICH.location, SHANGHAI.location], 800, 480);
        const a = tilePosition(ZURICH.location.lat, ZURICH.location.long, view.zoom);
        const b = tilePosition(SHANGHAI.location.lat, SHANGHAI.location.long, view.zoom);
        expect(Math.abs(a.x - b.x) * 256).toBeLessThanOrEqual(800 - 112);
        // and as close as it can: one level more would not fit
        const closer = view.zoom + 1;
        const c = tilePosition(ZURICH.location.lat, ZURICH.location.long, closer);
        const d = tilePosition(SHANGHAI.location.lat, SHANGHAI.location.long, closer);
        expect(Math.abs(c.x - d.x) * 256).toBeGreaterThan(800 - 112);
        expect(fitView([ZURICH.location], 800, 480).zoom).toBe(14);
    });

    it('groups pins that would overlap and separates them when zoomed in', () => {
        const items = [ZURICH, ZURICH_OLD_TOWN, SHANGHAI];
        const wide = clusterPins(items, { ...fitView(items.map(i => i.location), 800, 480) });
        expect(wide.map(cluster => cluster.items.length).sort()).toEqual([1, 2]);
        const close = clusterPins(items, { lat: 47.37, long: 8.542, zoom: 17 });
        expect(close.every(cluster => cluster.items.length === 1)).toBe(true);
    });

    it('opens a photo from its pin and zooms into a group', async () => {
        const onOpen = vi.fn();
        const div = document.createElement('div');
        document.body.appendChild(div);
        const root = createRoot(div);
        await act(async () => root.render(
            <ThemeProvider theme={createAppTheme('light')}>
                <RoomMap items={[ZURICH, ZURICH_OLD_TOWN, SHANGHAI]} unplaced={2} onOpen={onOpen} />
            </ThemeProvider>));

        expect(div.textContent).toContain('3 photos on the map · 2 without a location');
        await act(async () => div.querySelector('button[aria-label="Open bund.jpg"]').click());
        expect(onOpen).toHaveBeenCalledWith(SHANGHAI.tile);

        const group = div.querySelector('button[aria-label^="2 photos here"]');
        expect(group.textContent).toContain('2');
        await act(async () => group.click());
        expect(onOpen).toHaveBeenCalledTimes(1);
        await act(async () => root.unmount());
    });

    it('says how to add locations when none of the photos has one', async () => {
        const div = document.createElement('div');
        const root = createRoot(div);
        await act(async () => root.render(<RoomMap items={[]} unplaced={4} onOpen={vi.fn()} />));
        expect(div.textContent).toContain('Add a location');
        expect(div.textContent).toContain('4 without a location');
        await act(async () => root.unmount());
    });
});
