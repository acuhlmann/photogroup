import React, { act } from 'react';
import { createRoot } from 'react-dom/client';
import { afterEach, describe, expect, it, vi } from 'vitest';
import EventEmitter from 'eventemitter3';
import Gallery from '../Gallery';

vi.mock('../ContentTile', () => ({ default: ({ tile }) => <img alt={tile.fileName} /> }));
vi.mock('../LoadingTile', () => ({ default: () => null }));
vi.mock('../PhotoViewer', () => ({ default: () => null }));
vi.mock('../../topology/NetworkReadout', () => ({ default: () => null }));

describe('Gallery room synchronization', () => {
    let root;
    let container;
    afterEach(() => {
        act(() => root.unmount());
        container.remove();
        vi.useRealTimers();
    });

    function setup() {
        vi.useFakeTimers();
        const master = { emitter: new EventEmitter() };
        container = document.createElement('div');
        document.body.appendChild(container);
        root = createRoot(container);
        act(() => root.render(<Gallery master={master} showNetworkReadout={false} />));
        return master.emitter;
    }

    it('does not show the empty-room prompt when the snapshot times out', () => {
        setup();
        expect(container.textContent).toContain("Loading this room's photos…");
        act(() => vi.advanceTimersByTime(4000));
        expect(container.textContent).toContain('taking longer to load');
        expect(container.textContent).not.toContain('Share photos and clips');
    });

    it('shows the empty-room prompt after a delayed empty snapshot', () => {
        const emitter = setup();
        act(() => vi.advanceTimersByTime(4000));
        act(() => emitter.emit('photos', { type: 'all', item: [] }));
        expect(container.textContent).toContain('Share photos and clips');
        expect(container.textContent).not.toContain('taking longer to load');
    });

    it('shows photos when a populated snapshot arrives after the timeout', () => {
        const emitter = setup();
        act(() => vi.advanceTimersByTime(4000));
        act(() => emitter.emit('photos', { type: 'all', item: [{
            infoHash: 'photo', fileName: 'photo.jpg', img: 'blob:photo', loading: false,
            picDateTaken: '10:0 Jan 1 2024',
        }] }));
        expect(container.querySelector('img[alt="photo.jpg"]')).not.toBeNull();
        expect(container.textContent).not.toContain('Share photos and clips');
        expect(container.textContent).not.toContain('taking longer to load');
    });

    it('waits for a snapshot rather than treating incremental events as synchronization', () => {
        const emitter = setup();
        act(() => emitter.emit('photos', { type: 'update', item: [] }));
        expect(container.textContent).not.toContain('Share photos and clips');
        act(() => emitter.emit('photos', { type: 'all', item: [] }));
        expect(container.textContent).toContain('Share photos and clips');
        expect(vi.getTimerCount()).toBe(0);
    });
});
