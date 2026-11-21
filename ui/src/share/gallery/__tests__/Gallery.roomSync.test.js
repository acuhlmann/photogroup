import React, { act } from 'react';
import { createRoot } from 'react-dom/client';
import { afterEach, describe, expect, it, vi } from 'vitest';
import EventEmitter from 'eventemitter3';
import Gallery from '../Gallery';

vi.mock('../ContentTile', () => ({ default: ({ tile }) => <img alt={tile.fileName} /> }));
vi.mock('../PhotoList', () => ({ default: ({ tiles }) => tiles.map(tile => <img key={tile.infoHash} alt={tile.fileName} />) }));
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

    it('shows placeholders, not the empty-room prompt, while the snapshot is on its way', () => {
        setup();
        expect(container.querySelector('[data-testid="room-placeholder"]')).not.toBeNull();
        act(() => vi.advanceTimersByTime(15000));
        expect(container.querySelector('[data-testid="room-placeholder"]')).not.toBeNull();
        expect(container.textContent).not.toContain('Add photos and clips');
    });

    it('shows the kept copy of the room at once, but only the server says the room is empty', () => {
        const emitter = setup();
        act(() => emitter.emit('photos', { type: 'all', kept: true, item: [{
            infoHash: 'kept', fileName: 'kept.jpg', img: 'blob:kept', loading: false,
            picDateTaken: '10:0 Jan 1 2024',
        }] }));
        expect(container.querySelector('img[alt="kept.jpg"]')).not.toBeNull();
        act(() => emitter.emit('photos', { type: 'all', item: [] }));
        expect(container.querySelector('img[alt="kept.jpg"]')).toBeNull();
        expect(container.textContent).toContain('Add photos and clips');
    });

    it('shows the empty-room prompt after a delayed empty snapshot', () => {
        const emitter = setup();
        act(() => vi.advanceTimersByTime(4000));
        act(() => emitter.emit('photos', { type: 'all', item: [] }));
        expect(container.textContent).toContain('Add photos and clips');
    });

    it('shows photos when a populated snapshot arrives after the timeout', () => {
        const emitter = setup();
        act(() => vi.advanceTimersByTime(4000));
        act(() => emitter.emit('photos', { type: 'all', item: [{
            infoHash: 'photo', fileName: 'photo.jpg', img: 'blob:photo', loading: false,
            picDateTaken: '10:0 Jan 1 2024',
        }] }));
        expect(container.querySelector('img[alt="photo.jpg"]')).not.toBeNull();
        expect(container.textContent).not.toContain('Add photos and clips');
    });

    it('waits for a snapshot rather than treating incremental events as synchronization', () => {
        const emitter = setup();
        act(() => emitter.emit('photos', { type: 'update', item: [] }));
        expect(container.textContent).not.toContain('Add photos and clips');
        act(() => emitter.emit('photos', { type: 'all', item: [] }));
        expect(container.textContent).toContain('Add photos and clips');
        expect(vi.getTimerCount()).toBe(0);
    });
});
