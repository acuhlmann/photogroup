import React from 'react';
import { describe, it, expect, vi } from 'vitest';
import { createRoot } from 'react-dom/client';
import { act } from 'react';
import EventEmitter from 'eventemitter3';

// The map is drawn on a canvas, which jsdom leaves blank, but the recording it
// attaches is what the footer logs — so the real stage is rendered here.
vi.mock('../MeView', () => ({ default: () => <div data-testid="me-view" /> }));

const { default: GeekStage } = await import('./GeekStage');

const tab = (div, text) => Array.from(div.querySelectorAll('[role="tab"]')).find(t => t.textContent.includes(text));
const rows = div => Array.from(div.querySelectorAll('[role="log"] li')).map(li => li.textContent);

describe('GeekStage', () => {
    it('shows the graph and logs traffic as it happens, newest first', async () => {
        const master = { emitter: new EventEmitter(), client: { peerId: 'me' } };
        const div = document.createElement('div');
        const root = createRoot(div);
        await act(async () => root.render(<GeekStage master={master} tiles={[]} />));
        expect(div.querySelector('[data-testid="network-stage"]')).not.toBeNull();
        expect(div.textContent).toContain('listening');

        const torrent = { name: 'beach.jpg', infoHash: 'abc' };
        await act(async () => {
            master.emitter.emit('peers', { type: 'add', item: { name: 'Ana', peerId: 'p1' } });
            master.emitter.emit('downloadProgress', { torrent, speed: '1 MB/s', progress: 10 });
            master.emitter.emit('downloadProgress', { torrent, speed: '2 MB/s', progress: 20 });
        });
        const lines = rows(div);
        // The second progress event comes too soon after the first to get its own line.
        expect(lines).toHaveLength(2);
        expect(lines[0]).toContain('1 MB/s ← beach.jpg 10%');
        expect(lines[1]).toContain('Ana joined');

        const device = tab(div, 'This device');
        await act(async () => device.click());
        expect(div.querySelector('[data-testid="me-view"]')).not.toBeNull();
        await act(async () => root.unmount());
    });

    it('starts with the log closed on a phone and opens it from the selected tab', async () => {
        const master = { emitter: new EventEmitter(), client: { peerId: 'me' } };
        const div = document.createElement('div');
        const root = createRoot(div);
        await act(async () => root.render(<GeekStage master={master} isMobile />));
        expect(div.textContent).not.toContain('listening');
        await act(async () => tab(div, 'Packets').click());
        expect(div.textContent).toContain('listening');
        await act(async () => root.unmount());
    });

    it('holds the traffic, and says so on both the bar and the map', async () => {
        const master = { emitter: new EventEmitter(), client: { peerId: 'me' } };
        const div = document.createElement('div');
        const root = createRoot(div);
        await act(async () => root.render(<GeekStage master={master} tiles={[]} />));
        const hold = div.querySelector('[aria-label="Hold the traffic"]');
        expect(hold).not.toBeNull();

        await act(async () => hold.click());
        expect(div.querySelector('[data-testid="paused-mark"]')).not.toBeNull();
        expect(div.querySelector('[aria-label="Let the traffic run"]')).not.toBeNull();

        // While held, traffic the room sends is not lost: it waits behind the playhead.
        await act(async () => {
            master.emitter.emit('peers', { type: 'add', item: { name: 'Ana', peerId: 'p1' } });
        });
        expect(div.textContent).toContain('1 new');
        await act(async () => Array.from(div.querySelectorAll('button')).find(b => b.textContent.includes('new')).click());
        expect(div.querySelector('[data-testid="paused-mark"]')).toBeNull();
        await act(async () => root.unmount());
    });

    it('walks the recording one event at a time', async () => {
        const master = { emitter: new EventEmitter(), client: { peerId: 'me' } };
        const div = document.createElement('div');
        const root = createRoot(div);
        await act(async () => root.render(<GeekStage master={master} tiles={[]} />));
        await act(async () => {
            master.emitter.emit('peers', { type: 'add', item: { name: 'Ana', peerId: 'p1' } });
            master.emitter.emit('peers', { type: 'add', item: { name: 'Bo', peerId: 'p2' } });
        });

        await act(async () => div.querySelector('[aria-label="Previous event"]').click());
        expect(div.textContent).toContain('held');
        // Parked on the newest event, which is the one at the top of the log.
        expect(div.querySelector('[role="log"] li[data-parked="true"]').textContent).toContain('Bo joined');
        await act(async () => div.querySelector('[aria-label="Previous event"]').click());
        expect(div.querySelector('[role="log"] li[data-parked="true"]').textContent).toContain('Ana joined');
        await act(async () => div.querySelector('[aria-label="Next event"]').click());
        expect(div.querySelector('[role="log"] li[data-parked="true"]').textContent).toContain('Bo joined');
        await act(async () => root.unmount());
    });

    it('parks the map on an event when its log line is tapped', async () => {
        const master = { emitter: new EventEmitter(), client: { peerId: 'me' } };
        const div = document.createElement('div');
        const root = createRoot(div);
        await act(async () => root.render(<GeekStage master={master} tiles={[]} />));
        await act(async () => {
            master.emitter.emit('peers', { type: 'add', item: { name: 'Ana', peerId: 'p1' } });
        });
        expect(div.querySelector('[data-testid="paused-mark"]')).toBeNull();

        await act(async () => rows(div) && div.querySelector('[role="log"] li').click());
        // The map is held on that crossing, and the line says so.
        expect(div.querySelector('[data-testid="paused-mark"]')).not.toBeNull();
        expect(div.querySelector('[role="log"] li[data-parked="true"]')).not.toBeNull();
        await act(async () => root.unmount());
    });

    it('grows the log from a collapsed drawer on a phone', async () => {
        const master = { emitter: new EventEmitter(), client: { peerId: 'me' } };
        const div = document.createElement('div');
        const root = createRoot(div);
        await act(async () => root.render(<GeekStage master={master} isMobile />));
        const collapsed = div.querySelector('[aria-label="Show the log"]');
        await act(async () => collapsed.click());
        expect(div.querySelector('[aria-label="Hide the log"]')).not.toBeNull();
        expect(div.querySelector('[role="separator"]')).not.toBeNull();
        await act(async () => root.unmount());
    });
});
