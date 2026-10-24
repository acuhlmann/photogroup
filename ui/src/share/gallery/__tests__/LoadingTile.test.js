import React from 'react';
import { describe, it, expect, vi, afterEach } from 'vitest';
import { createRoot } from 'react-dom/client';
import { act } from 'react';
import { EventEmitter } from 'events';

vi.mock('../../torrent/PiecesLoadingView', () => ({ default: () => null }));
vi.mock('../../torrent/TransferConsole', () => ({ default: () => null }));
vi.mock('../OwnersList', () => ({ default: () => null }));

import LoadingTile from '../LoadingTile';

describe('LoadingTile', () => {
    afterEach(() => vi.restoreAllMocks());

    it('creates the upload preview URL once instead of on every render', async () => {
        let n = 0;
        URL.createObjectURL = URL.createObjectURL || (() => '');
        const createObjectURL = vi.spyOn(URL, 'createObjectURL').mockImplementation(() => 'blob:preview-' + (++n));
        const master = { emitter: new EventEmitter(), client: { peerId: 'me' } };
        const tile = {
            infoHash: 'temp', loading: true, rendering: true, fileName: 'a.jpg', owners: [],
            thumbnailFiles: [new File(['x'], 'Thumbnail a.jpg', { type: 'image/jpeg' })],
        };
        const div = document.createElement('div');
        const root = createRoot(div);

        await act(async () => root.render(<LoadingTile tile={tile} master={master} name="a" />));
        await act(async () => root.render(<LoadingTile tile={{ ...tile }} master={master} name="a" />));

        expect(createObjectURL).toHaveBeenCalledTimes(1);
        expect(tile.previewUrl).toBe('blob:preview-1');
        expect(div.querySelector('img').getAttribute('src')).toBe('blob:preview-1');

        await act(async () => root.unmount());
    });

    it('says who the photo waits for, and offers to ask for a server copy once stalled', async () => {
        vi.useFakeTimers();
        try {
            const emitter = new EventEmitter();
            const asked = vi.fn();
            emitter.on('fetchServerCopyNow', asked);
            const master = { emitter, client: { peerId: 'me' }, peers: { items: [{ peerId: 'me' }, { peerId: 'alex', name: 'Alex', away: 1 }] } };
            const tile = { infoHash: 'h', loading: true, fileName: 'a.jpg', owners: [{ peerId: 'alex', loading: false }] };
            const div = document.createElement('div');
            const root = createRoot(div);

            await act(async () => root.render(<LoadingTile tile={tile} master={master} name="a" />));
            expect(div.textContent).toContain('Waiting for Alex to come back');

            await act(async () => vi.advanceTimersByTime(20000));
            const button = [...div.querySelectorAll('button')].find(item => item.textContent === 'Ask for a server copy');
            expect(div.textContent).toContain('is in another app');
            await act(async () => button.click());
            expect(asked).toHaveBeenCalledWith(tile);

            await act(async () => root.unmount());
        } finally {
            vi.useRealTimers();
        }
    });
});
