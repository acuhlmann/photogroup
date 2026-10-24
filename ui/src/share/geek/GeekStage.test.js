import React from 'react';
import { describe, it, expect, vi } from 'vitest';
import { createRoot } from 'react-dom/client';
import { act } from 'react';
import EventEmitter from 'eventemitter3';

// The map is drawn on a canvas, which jsdom leaves blank, but the recording it
// attaches is what the footer logs — so the real stage is rendered here.

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

        const transfers = tab(div, 'Transfers');
        await act(async () => transfers.click());
        expect(div.querySelector('[data-testid="transfers"]')).not.toBeNull();
        expect(div.textContent).toContain('no transfers yet');
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

    it('makes the log taller when the grip is dragged up, tracking the finger', async () => {
        const master = { emitter: new EventEmitter(), client: { peerId: 'me' } };
        const div = document.createElement('div');
        const root = createRoot(div);
        await act(async () => root.render(<GeekStage master={master} tiles={[]} />));
        const edge = () => div.querySelector('[role="separator"]');
        const value = () => Number(edge().getAttribute('aria-valuenow'));
        const start = value();

        // 768px of jsdom viewport, so the log may take 630px of it.
        await act(async () => {
            edge().dispatchEvent(new PointerEvent('pointerdown', { bubbles: true, clientY: 500, pointerId: 1 }));
        });
        await act(async () => {
            window.dispatchEvent(new PointerEvent('pointermove', { bubbles: true, clientY: 300, pointerId: 1 }));
        });
        expect(value()).toBe(start + 200);
        await act(async () => {
            window.dispatchEvent(new PointerEvent('pointerup', { bubbles: true, clientY: 300, pointerId: 1 }));
        });
        expect(localStorage.setItem).toHaveBeenCalledWith('photogroup.geekDrawerHeight', String(start + 200));
        await act(async () => root.unmount());
    });

    it('grows a collapsed drawer as soon as the grip moves, without a dead zone', async () => {
        const master = { emitter: new EventEmitter(), client: { peerId: 'me' } };
        const div = document.createElement('div');
        const root = createRoot(div);
        await act(async () => root.render(<GeekStage master={master} isMobile tiles={[]} />));
        const edge = () => div.querySelector('[role="separator"]');
        const value = () => Number(edge().getAttribute('aria-valuenow'));
        expect(value()).toBe(33);

        await act(async () => {
            edge().dispatchEvent(new PointerEvent('pointerdown', { bubbles: true, clientY: 700, pointerId: 2 }));
        });
        await act(async () => {
            window.dispatchEvent(new PointerEvent('pointermove', { bubbles: true, clientY: 660, pointerId: 2 }));
        });
        // The log is open and already 40px past where it started, not parked
        // at some floor until the finger catches up.
        expect(value()).toBe(260 + 40);
        await act(async () => root.unmount());
    });

    it('resizes the log from the keyboard, and fills the screen from the button', async () => {
        const master = { emitter: new EventEmitter(), client: { peerId: 'me' } };
        const div = document.createElement('div');
        const root = createRoot(div);
        await act(async () => root.render(<GeekStage master={master} tiles={[]} />));
        const edge = () => div.querySelector('[role="separator"]');
        const value = () => Number(edge().getAttribute('aria-valuenow'));
        const key = k => act(async () => {
            edge().dispatchEvent(new KeyboardEvent('keydown', { bubbles: true, key: k }));
        });
        const start = value();

        await key('ArrowUp');
        expect(value()).toBe(start + 40);
        await key('PageUp');
        expect(value()).toBe(start + 160);
        await key('ArrowDown');
        expect(value()).toBe(start + 120);

        // Holding the grip and pressing End takes the whole stage, which is
        // what the button on the bar does too.
        await key('End');
        const tallest = Number(edge().getAttribute('aria-valuemax'));
        expect(value()).toBe(tallest);
        await act(async () => div.querySelector('[aria-label="Give the map its room back"]').click());
        expect(value()).toBeLessThan(tallest);
        await act(async () => div.querySelector('[aria-label="Give the log the whole screen"]').click());
        expect(value()).toBe(tallest);
        await act(async () => root.unmount());
    });

    it('keeps a height taller than the old ceiling, clamped to this screen', async () => {
        localStorage.getItem.mockReturnValue('700');
        const master = { emitter: new EventEmitter(), client: { peerId: 'me' } };
        const div = document.createElement('div');
        const root = createRoot(div);
        await act(async () => root.render(<GeekStage master={master} tiles={[]} />));
        const edge = div.querySelector('[role="separator"]');
        // 700 was thrown away before, so the log came back at its default.
        expect(Number(edge.getAttribute('aria-valuenow'))).toBe(Number(edge.getAttribute('aria-valuemax')));
        localStorage.getItem.mockReset();
        await act(async () => root.unmount());
    });
});
