import React from 'react';
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { createRoot } from 'react-dom/client';
import { act } from 'react';
import EventEmitter from 'eventemitter3';
import NetworkStage from './NetworkStage';
import { createTimeline } from './timeline';

// jsdom hands back a null canvas context, so the whole draw loop — the part
// that decides whether you see a map or a blank rectangle — never runs in a
// normal test. These drive it with a fake 2D context and frames we choose to
// run, and record what was painted.
let contexts;
let frames;

const fakeContext = () => {
    const ctx = {
        painted: [], plates: [], calls: 0,
        canvas: { width: 0, height: 0 },
        fillStyle: '', strokeStyle: '', lineWidth: 1, font: '', textAlign: '', textBaseline: '',
        setTransform: () => {}, clearRect: () => {}, save: () => {}, restore: () => {},
        beginPath: () => {}, closePath: () => {}, moveTo: () => {}, lineTo: () => {},
        arc: () => {}, arcTo: () => {}, clip: () => {}, fill: () => {}, stroke: () => {},
        // What colour a rectangle was painted in: how a test tells the video
        // plate apart from the grey "no picture yet" box.
        fillRect: () => { ctx.plates.push(ctx.fillStyle); },
        setLineDash: () => {}, drawImage: () => { ctx.calls += 1; },
        measureText: value => ({ width: String(value).length * 6 }),
        // The only paint call that carries text, so labels are what we assert on.
        fillText: (value, x, y) => { ctx.painted.push({ text: String(value), x, y }); },
    };
    return ctx;
};

let originalGetContext;
let originalRaf;
let originalCancel;
let originalRect;

beforeEach(() => {
    contexts = [];
    frames = [];
    originalGetContext = HTMLCanvasElement.prototype.getContext;
    HTMLCanvasElement.prototype.getContext = function getContext(type) {
        if (type !== '2d') return originalGetContext.call(this, type);
        const made = fakeContext();
        contexts.push(made);
        return made;
    };
    originalRaf = window.requestAnimationFrame;
    originalCancel = window.cancelAnimationFrame;
    window.requestAnimationFrame = cb => { frames.push(cb); return frames.length; };
    window.cancelAnimationFrame = () => {};
    originalRect = Element.prototype.getBoundingClientRect;
    Element.prototype.getBoundingClientRect = () => ({
        left: 0, top: 0, right: 900, bottom: 600, width: 900, height: 600, x: 0, y: 0,
    });
});

afterEach(() => {
    HTMLCanvasElement.prototype.getContext = originalGetContext;
    window.requestAnimationFrame = originalRaf;
    window.cancelAnimationFrame = originalCancel;
    Element.prototype.getBoundingClientRect = originalRect;
});

/** Run the next `count` animation frames, one at a time. */
const runFrames = async (count = 1) => {
    for (let index = 0; index < count; index++) {
        const pending = frames.splice(0, frames.length);
        await act(async () => { pending.forEach(draw => draw(performance.now())); });
    }
};

const texts = () => contexts.flatMap(ctx => ctx.painted.map(painted => painted.text));

const mount = async ({ tiles = [], master, timeline = createTimeline() } = {}) => {
    const div = document.createElement('div');
    document.body.appendChild(div);
    const root = createRoot(div);
    await act(async () => root.render(
        <NetworkStage master={master} tiles={tiles} onOpenPhoto={() => {}} timeline={timeline} />
    ));
    return { div, root, timeline };
};

const room = () => ({
    emitter: new EventEmitter(), client: { peerId: 'me' }, me: { name: 'Mine' },
    peers: {
        items: [{ peerId: 'them', name: 'Ana' }],
        // A settled WebRTC connection is what gives the scene a transfer route
        // to put a piece on; without one there is nowhere for the dot to go.
        connections: [{ fromPeerId: 'me', toPeerId: 'them', connectionType: 'p2p' }],
    },
    creator: {}, roomPhotos: { all: () => [] },
});

describe('NetworkStage drawing', () => {
    it('paints a frame at all, which is what a blank map would not', async () => {
        const { root, div } = await mount({ master: room() });
        await runFrames(1);
        expect(contexts.length).toBeGreaterThan(0);
        // A frame clears, draws the tiers and the nodes, and asks for the geometry.
        expect(contexts[0].painted.length).toBeGreaterThan(0);
        await act(async () => root.unmount());
        div.remove();
    });

    it('draws the label of a packet that is crossing, read from the recording', async () => {
        const master = room();
        const { root, div, timeline } = await mount({ master });
        const torrent = { name: 'beach.jpg', infoHash: 'abc', pieces: new Array(4).fill(0), pieceLength: 1024 };

        master.emitter.emit('pieceReceived', { torrent, index: 3, total: 4, size: 1024, peerId: 'them' });
        expect(timeline.entries.at(-1).flights.length).toBe(1);

        await runFrames(1);
        // A device with a transfer route is a device we draw the packet on.
        const drawn = texts().filter(text => text.startsWith('#'));
        expect(drawn.length).toBe(1);
        expect(drawn[0]).toBe('#4/4 1.02 kB');

        await act(async () => root.unmount());
        div.remove();
    });

    it('holds the label in place while paused, and puts it back when scrubbed', async () => {
        const master = room();
        // The recording's own clock: seeking never goes past "now", so the
        // packet must have finished crossing before we scrub around in it.
        const clock = { value: 1000000 };
        const { root, div, timeline } = await mount({ master, timeline: createTimeline({ now: () => clock.value }) });
        const torrent = { name: 'beach.jpg', infoHash: 'abc', pieces: new Array(4).fill(0), pieceLength: 1024 };
        master.emitter.emit('pieceReceived', { torrent, index: 3, total: 4, size: 1024, peerId: 'them' });
        clock.value += 10000;

        // Park mid-crossing: the same label, at the same place, frame after frame.
        const entry = timeline.entries.at(-1);
        timeline.seek(entry.at + entry.flights[0].dur / 2);
        await runFrames(1);
        const held = contexts.at(-1).painted.find(painted => painted.text.startsWith('#'));
        expect(held).toBeTruthy();

        contexts.at(-1).painted.length = 0;
        await runFrames(1);
        const again = contexts.at(-1).painted.find(painted => painted.text.startsWith('#'));
        expect(again).toBeTruthy();
        // Frozen: nothing moved between the two frames.
        expect(again.x).toBe(held.x);
        expect(again.y).toBe(held.y);

        // Scrub to where it had barely left, and it is drawn near the start.
        contexts.at(-1).painted.length = 0;
        timeline.seek(timeline.entries.at(-1).at + 1);
        await runFrames(1);
        const early = contexts.at(-1).painted.find(painted => painted.text.startsWith('#'));
        expect(early.x).not.toBe(held.x);

        await act(async () => root.unmount());
        div.remove();
    });

    it('paints a video tile it cannot still-frame as a clip, not as a blank box', async () => {
        const master = room();
        const clip = new File(['x'], 'dock.mp4', { type: 'video/mp4' });
        const tiles = [{
            infoHash: 'v1', fileName: 'dock.mp4', fileType: 'video/mp4', isVideo: true,
            img: null, file: clip, owners: [{ peerId: 'me' }],
        }];
        const { root, div } = await mount({ master, tiles });

        await runFrames(1);
        const ctx = contexts.at(-1);
        // The video branch paints its own dark plate before the play badge. No
        // still frame exists here, and the old code drew nothing at all: this
        // colour is how the test tells "it is a clip" apart from the grey void.
        expect(ctx.plates).toContain('rgba(9,12,18,0.92)');
        expect(ctx.calls).toBe(0);

        await act(async () => root.unmount());
        div.remove();
    });

    it('paints the grey box for a picture that has not arrived, and not the clip plate', async () => {
        const master = room();
        const tiles = [{ infoHash: 'i1', fileName: 'soon.jpg', fileType: 'image/jpeg', img: null, owners: [{ peerId: 'me' }] }];
        const { root, div } = await mount({ master, tiles });

        await runFrames(1);
        expect(contexts.at(-1).plates).not.toContain('rgba(9,12,18,0.92)');

        await act(async () => root.unmount());
        div.remove();
    });

    it('paints the preview that came with the share for media this device does not hold', async () => {
        const master = room();
        // The server's shelf: a photo it keeps that this browser has no bytes
        // of, so it has no img - only the small preview that came with it.
        const tiles = [{
            infoHash: 's1', fileName: 'away.jpg', fileType: 'image/jpeg', img: null,
            previewUrl: 'blob:preview-s1', hasServerCopy: true, owners: [{ peerId: 'ana' }],
        }];
        const requested = [];
        const RealImage = window.Image;
        // jsdom never finishes an Image, so the loop would fall back to the
        // grey void no matter which source it picked. A completed fake lets the
        // test see which URL the drawing actually asked for.
        window.Image = class FakeImage {
            constructor() { this.complete = true; this.naturalWidth = 20; this.naturalHeight = 10; }
            set src(value) { requested.push(value); }
            get src() { return ''; }
        };
        try {
            const { root, div } = await mount({ master, tiles });
            await runFrames(1);
            expect(requested).toContain('blob:preview-s1');
            // Painted, not the grey void: once under this device and once on
            // the server's shelf. The count is per frame, so assert it drew.
            expect(contexts.at(-1).calls).toBeGreaterThan(0);
            expect(contexts.at(-1).plates).not.toContain('rgba(9,12,18,0.92)');
            await act(async () => root.unmount());
            div.remove();
        } finally {
            window.Image = RealImage;
        }
    });

    it('keeps drawing frames until unmounted, and stops when it is', async () => {
        const master = room();
        const { root } = await mount({ master });
        await runFrames(3);
        expect(frames.length).toBe(1); // the loop always queues exactly one next frame

        await act(async () => root.unmount());
        const before = contexts.length;
        await runFrames(1);
        expect(contexts.length).toBe(before);
    });
});

