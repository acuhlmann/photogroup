import React from 'react';
import { describe, it, expect, vi } from 'vitest';
import { createRoot } from 'react-dom/client';
import { act } from 'react';
import { ThemeProvider } from '@mui/material/styles';
import { createAppTheme } from '../../theme';
import RoomMap, { clusterPins, fitView, tripRoute } from './RoomMap';
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

    it('joins dated photos in the order taken, a line for each day', () => {
        const at = (base, time) => ({ ...base, takenAt: new Date(time).getTime() });
        const route = tripRoute([
            at(SHANGHAI, '2026-10-13T09:00'),
            at(ZURICH_OLD_TOWN, '2026-10-12T15:00'),
            ZURICH_OLD_TOWN, // no date: not on the route
            at(ZURICH, '2026-10-12T10:00'),
        ]);
        expect(route.map(day => day.day)).toEqual(['2026-10-12', '2026-10-13']);
        expect(route[0].points).toEqual([ZURICH.location, ZURICH_OLD_TOWN.location]);
        // the next day carries on from where the last one ended
        expect(route[1].points).toEqual([ZURICH_OLD_TOWN.location, SHANGHAI.location]);
        expect(route[0].colour).not.toBe(route[1].colour);
        expect(tripRoute([at(ZURICH, '2026-10-12T10:00'), SHANGHAI])).toEqual([]);
    });

    it('draws the trip route with a legend and hides it on request', async () => {
        const div = document.createElement('div');
        document.body.appendChild(div);
        const root = createRoot(div);
        const items = [
            { ...ZURICH, takenAt: new Date('2026-10-12T10:00').getTime() },
            { ...SHANGHAI, takenAt: new Date('2026-10-14T10:00').getTime() },
        ];
        await act(async () => root.render(
            <ThemeProvider theme={createAppTheme('light')}>
                <RoomMap items={items} onOpen={vi.fn()} />
            </ThemeProvider>));

        expect(div.querySelectorAll('[data-testid="trip-route"] polyline').length).toBe(4);
        expect(div.querySelector('[data-testid="trip-days"]').textContent).toMatch(/Day 1.*Day 2/);
        const toggle = div.querySelector('button[aria-label="Trip route"]');
        expect(toggle.getAttribute('aria-pressed')).toBe('true');
        await act(async () => toggle.click());
        expect(div.querySelector('[data-testid="trip-route"]')).toBeNull();
        expect(div.querySelector('[data-testid="trip-days"]')).toBeNull();
        expect(toggle.getAttribute('aria-pressed')).toBe('false');
        await act(async () => root.unmount());
        div.remove();
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
