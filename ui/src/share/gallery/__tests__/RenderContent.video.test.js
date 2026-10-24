import React, { act } from 'react';
import { createRoot } from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import EventEmitter from 'eventemitter3';
import RenderContent from '../RenderContent';

// The player is attached inside a promise, so the container is still empty
// while it is in flight. Two renders in that window used to start two players
// for one clip: two control bars, two blob URLs, neither sized.

// A clip this device holds: `torrent` is what gives the container its key (and
// the stage subscribes to it, so it has to be an emitter), and `torrentFile` is
// the file handed to the player.
const videoTile = (extra = {}) => {
    const torrent = new EventEmitter();
    torrent.infoHash = 'clip';
    return {
        infoHash: 'clip',
        fileName: 'dock.mp4',
        fileType: 'video/mp4',
        isVideo: true,
        file: new Blob(['x'], { type: 'video/mp4' }),
        torrent,
        torrentFile: { length: 100, size: 100, progress: 0.5 },
        ...extra,
    };
};

describe('RenderContent video player', () => {
    let root;
    let container;
    let master;

    beforeEach(() => {
        URL.createObjectURL = vi.fn(() => `blob:${Math.random()}`);
        master = { emitter: new EventEmitter(), metadata: { readMetadata: vi.fn() } };
        container = document.createElement('div');
        document.body.appendChild(container);
        root = createRoot(container);
    });

    afterEach(() => {
        act(() => root.unmount());
        container.remove();
    });

    const videos = () => container.querySelectorAll('video');

    it('attaches one player, not one per render, while the first is still landing', async () => {
        // The old guard only consulted node.infoHash once a child already
        // existed, and the child is appended from a promise, so a second commit
        // in that window started a second player for the same clip.
        //
        // The two renders must stay in SEPARATE act() calls. Inside one act()
        // React coalesces them into a single commit, the window never opens, and
        // this passes against the buggy code too.
        act(() => root.render(<RenderContent tile={videoTile()} master={master} />));
        act(() => root.render(<RenderContent tile={videoTile()} master={master} />));
        await act(async () => {});

        expect(videos()).toHaveLength(1);
        expect(URL.createObjectURL).toHaveBeenCalledTimes(1);
    });

    it('still makes one player across settled re-renders', async () => {
        act(() => root.render(<RenderContent tile={videoTile()} master={master} />));
        await act(async () => {});
        expect(videos()).toHaveLength(1);

        act(() => root.render(<RenderContent tile={videoTile()} master={master} />));
        await act(async () => {});
        expect(videos()).toHaveLength(1);
        expect(URL.createObjectURL).toHaveBeenCalledTimes(1);
    });

    it('sizes the player by the clip, not by the 150px default', async () => {
        act(() => root.render(<RenderContent tile={videoTile()} master={master} />));
        await act(async () => {});

        const elem = videos()[0];
        expect(elem.style.width).toBe('100%');
        // Without height:auto a video keeps its intrinsic 150px box, which is
        // what made the control bar look like the whole element.
        expect(elem.style.height).toBe('auto');
        expect(elem.style.display).toBe('block');
    });

    it('swaps in the server copy for the same photo rather than adding to it', async () => {
        act(() => root.render(<RenderContent tile={videoTile()} master={master} />));
        await act(async () => {});
        const waiting = videos()[0];
        expect(waiting).toBeTruthy();

        // A copy delivered over HTTPS keys apart from the stalled torrent, so
        // its player replaces the waiting one instead of stacking beside it.
        const delivered = videoTile({ fromServerCopy: true, elem: new Blob(['s'], { type: 'video/mp4' }) });
        act(() => root.render(<RenderContent tile={delivered} master={master} />));
        await act(async () => {});

        expect(videos()).toHaveLength(1);
        expect(videos()[0]).not.toBe(waiting);
    });
});
