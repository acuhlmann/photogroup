import React, { act } from 'react';
import { createRoot } from 'react-dom/client';
import { describe, expect, it } from 'vitest';
import EventEmitter from 'eventemitter3';
import NetworkStatus from './NetworkStatus';

describe('NetworkStatus', () => {
    it('shows peers and speeds from transfer events, and nothing while idle', () => {
        const emitter = new EventEmitter();
        const div = document.createElement('div');
        const root = createRoot(div);
        let renders = 0;
        const Counted = () => { renders += 1; return <NetworkStatus emitter={emitter} />; };
        act(() => root.render(<Counted />));
        expect(div.textContent).toBe('');
        act(() => emitter.emit('numPeersChange', 2));
        act(() => emitter.emit('downloadProgress', { speed: '1 MB/s' }));
        expect(div.textContent).toContain('2 peers');
        expect(div.textContent).toContain('↓ 1 MB/s');
        act(() => emitter.emit('uploadProgress', { speed: '2 MB/s' }));
        expect(div.textContent).toContain('↑ 2 MB/s');
        // Transfer events redraw this bar only, not its parent.
        expect(renders).toBe(1);
        act(() => root.unmount());
    });

    it('shows the peers already here when it first shows', () => {
        const emitter = new EventEmitter();
        const div = document.createElement('div');
        const root = createRoot(div);
        act(() => root.render(<NetworkStatus emitter={emitter} peers={{ items: [{}, {}, {}] }} />));
        expect(div.textContent).toContain('3 peers');
        act(() => root.unmount());
    });
});
