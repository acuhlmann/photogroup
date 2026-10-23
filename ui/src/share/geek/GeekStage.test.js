import React from 'react';
import { describe, it, expect, vi } from 'vitest';
import { createRoot } from 'react-dom/client';
import { act } from 'react';
import EventEmitter from 'eventemitter3';

vi.mock('./NetworkStage', () => ({ default: ({ tiles }) => <div data-testid="topology">{(tiles || []).length} photos</div> }));
vi.mock('../MeView', () => ({ default: () => <div data-testid="me-view" /> }));

const { default: GeekStage } = await import('./GeekStage');

describe('GeekStage', () => {
    it('shows the graph and logs traffic as it happens, newest first', async () => {
        const master = { emitter: new EventEmitter() };
        const div = document.createElement('div');
        const root = createRoot(div);
        await act(async () => root.render(<GeekStage master={master} />));
        expect(div.querySelector('[data-testid="topology"]')).not.toBeNull();
        expect(div.textContent).toContain('listening');

        const torrent = { name: 'beach.jpg', infoHash: 'abc' };
        await act(async () => {
            master.emitter.emit('peers', { type: 'add', item: { name: 'Ana', peerId: 'p1' } });
            master.emitter.emit('downloadProgress', { torrent, speed: '1 MB/s', progress: 10 });
            master.emitter.emit('downloadProgress', { torrent, speed: '2 MB/s', progress: 20 });
        });
        const lines = Array.from(div.querySelectorAll('[role="log"] li')).map(li => li.textContent);
        // The second progress event comes too soon after the first to get its own line.
        expect(lines).toHaveLength(2);
        expect(lines[0]).toContain('1 MB/s ← beach.jpg 10%');
        expect(lines[1]).toContain('Ana joined');

        const deviceTab = Array.from(div.querySelectorAll('[role="tab"]')).find(tab => tab.textContent === 'This device');
        await act(async () => deviceTab.click());
        expect(div.querySelector('[data-testid="me-view"]')).not.toBeNull();
        await act(async () => root.unmount());
    });
});
