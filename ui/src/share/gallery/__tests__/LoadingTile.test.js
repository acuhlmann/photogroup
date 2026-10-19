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
});
