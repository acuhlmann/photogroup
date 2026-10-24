import React from 'react';
import { describe, it, expect, vi } from 'vitest';
import { createRoot } from 'react-dom/client';
import { act } from 'react';
import EventEmitter from 'eventemitter3';
import NetworkStage, { routeLabel, canOpen } from './NetworkStage';
import { createTimeline } from './timeline';
import { TIER, THUMB } from './scene';

// jsdom has no layout, so the stage falls back to an 800×600 scene.
const tap = (element, x, y) => element.dispatchEvent(new MouseEvent('pointerdown', { bubbles: true, clientX: x, clientY: y }));

describe('NetworkStage', () => {
    it('enlarges a photo on the first tap and opens it on the second', async () => {
        const master = { emitter: new EventEmitter(), client: { peerId: 'me' }, me: { name: 'Mine' } };
        const tiles = [{ infoHash: 'h1', fileName: 'beach.jpg', img: 'blob:beach', owners: [{ peerId: 'me' }] }];
        const onOpenPhoto = vi.fn();
        const div = document.createElement('div');
        document.body.appendChild(div);
        const root = createRoot(div);
        await act(async () => root.render(<NetworkStage master={master} tiles={tiles} onOpenPhoto={onOpenPhoto} timeline={createTimeline()} />));
        const canvas = div.querySelector('[data-testid="network-stage"]');
        expect(div.textContent).toContain('alone in this room');

        // My device is alone in the middle, with its one photo just underneath.
        const thumbY = 600 * TIER.device + 44 + THUMB / 2;
        await act(async () => tap(canvas, 400, thumbY));
        const preview = div.querySelector('[data-testid="thumb-preview"]');
        expect(preview.textContent).toContain('beach.jpg');
        expect(onOpenPhoto).not.toHaveBeenCalled();

        await act(async () => tap(canvas, 400, thumbY));
        expect(onOpenPhoto).toHaveBeenCalledWith('h1');

        // Tapping a node shows what we know about it.
        await act(async () => tap(canvas, 400, 600 * TIER.device));
        expect(div.querySelector('[data-testid="node-details"]').textContent).toContain('you · Mine');
        expect(div.querySelector('[data-testid="node-details"]').textContent).toContain('photos held 1');

        await act(async () => root.unmount());
        div.remove();
    });

    it('hands dropped files to the uploader', async () => {
        const master = { emitter: new EventEmitter(), client: { peerId: 'me' } };
        const onFiles = vi.fn();
        master.emitter.on('filesSelected', onFiles);
        const div = document.createElement('div');
        const root = createRoot(div);
        await act(async () => root.render(<NetworkStage master={master} tiles={[]} onOpenPhoto={() => {}} timeline={createTimeline()} />));
        const file = new File(['x'], 'a.jpg', { type: 'image/jpeg' });
        const drop = new Event('drop', { bubbles: true });
        drop.dataTransfer = { files: [file] };
        await act(async () => div.firstChild.dispatchEvent(drop));
        await vi.waitFor(() => expect(onFiles).toHaveBeenCalledWith([file]));
        await act(async () => root.unmount());
    });

    it('opens a video from the map, though it has no still image', async () => {
        const master = { emitter: new EventEmitter(), client: { peerId: 'me' }, me: { name: 'Mine' } };
        const clip = new File(['clip'], 'dock.mp4', { type: 'video/mp4' });
        // A video tile looks exactly like the one the gallery builds: no img,
        // because the player is the file itself.
        const tiles = [{
            infoHash: 'v1', fileName: 'dock.mp4', fileType: 'video/mp4', isVideo: true,
            img: null, file: clip, owners: [{ peerId: 'me' }],
        }];
        const onOpenPhoto = vi.fn();
        const div = document.createElement('div');
        document.body.appendChild(div);
        const root = createRoot(div);
        await act(async () => root.render(<NetworkStage master={master} tiles={tiles} onOpenPhoto={onOpenPhoto} timeline={createTimeline()} />));
        const canvas = div.querySelector('[data-testid="network-stage"]');
        const thumbY = 600 * TIER.device + 44 + THUMB / 2;
        await act(async () => tap(canvas, 400, thumbY));

        const preview = div.querySelector('[data-testid="thumb-preview"]');
        expect(preview.textContent).toContain('dock.mp4');
        expect(preview.querySelector('video')).not.toBeNull();
        // The grey box used to leave no way out: Open was disabled without an img.
        const open = Array.from(preview.querySelectorAll('button')).find(button => button.textContent.includes('Open full size'));
        expect(open.disabled).toBe(false);
        await act(async () => open.click());
        expect(onOpenPhoto).toHaveBeenCalledWith('v1');

        await act(async () => root.unmount());
        div.remove();
    });
    it('flips through the room from the detail card, and closes it when the photo opens', async () => {
        const master = { emitter: new EventEmitter(), client: { peerId: 'me' }, me: { name: 'Mine' } };
        const tiles = [
            { infoHash: 'h1', fileName: 'one.jpg', img: 'blob:1', owners: [{ peerId: 'me' }] },
            { infoHash: 'h2', fileName: 'two.jpg', img: 'blob:2', owners: [{ peerId: 'me' }] },
        ];
        const onOpenPhoto = vi.fn();
        const div = document.createElement('div');
        document.body.appendChild(div);
        const root = createRoot(div);
        await act(async () => root.render(<NetworkStage master={master} tiles={tiles} onOpenPhoto={onOpenPhoto} timeline={createTimeline()} />));
        const canvas = div.querySelector('[data-testid="network-stage"]');
        const card = () => div.querySelector('[data-testid="thumb-preview"]');
        const thumbY = 600 * TIER.device + 44 + THUMB / 2;

        // Two photos under one device: 34px each with a 6px gap, centred on 400.
        await act(async () => tap(canvas, 380, thumbY));
        expect(card().textContent).toContain('one.jpg');
        expect(card().textContent).toContain('1/2');

        await act(async () => card().querySelector('[aria-label="Next photo"]').click());
        expect(card().textContent).toContain('two.jpg');
        await act(async () => card().querySelector('[aria-label="Previous photo"]').click());
        expect(card().textContent).toContain('one.jpg');

        // Opening full size closes the card: left open, its own player sits
        // behind the viewer and the same clip shows two control bars.
        await act(async () => card().querySelector('button').click());
        expect(onOpenPhoto).toHaveBeenCalledWith('h1');
        expect(card()).toBeNull();

        await act(async () => root.unmount());
        div.remove();
    });

    it('says how much of the room has arrived, in one number', async () => {
        const master = { emitter: new EventEmitter(), client: { peerId: 'me' } };
        const tiles = [
            { infoHash: 'h1', fileName: 'a.jpg', img: 'blob:a', owners: [] },
            { infoHash: 'h2', fileName: 'b.jpg', loading: true, torrentFile: { progress: 0.5 }, owners: [] },
        ];
        const div = document.createElement('div');
        document.body.appendChild(div);
        const root = createRoot(div);
        await act(async () => root.render(<NetworkStage master={master} tiles={tiles} onOpenPhoto={() => {}} timeline={createTimeline()} />));
        const chip = div.querySelector('[data-testid="room-progress"]');
        // One whole photo plus half of the other, of two: 75%.
        expect(chip.textContent).toContain('1 of 2 here');
        expect(chip.textContent).toContain('75%');
        await act(async () => root.unmount());
        div.remove();
    });

    it('says nothing about loading once everything is here', async () => {
        const master = { emitter: new EventEmitter(), client: { peerId: 'me' } };
        const tiles = [{ infoHash: 'h1', fileName: 'a.jpg', img: 'blob:a', owners: [] }];
        const div = document.createElement('div');
        document.body.appendChild(div);
        const root = createRoot(div);
        await act(async () => root.render(<NetworkStage master={master} tiles={tiles} onOpenPhoto={() => {}} timeline={createTimeline()} />));
        expect(div.querySelector('[data-testid="room-progress"]')).toBeNull();
        await act(async () => root.unmount());
        div.remove();
    });
});

describe('canOpen', () => {
    it('needs a picture or bytes to show', () => {
        expect(canOpen({})).toBe(false);
        expect(canOpen(null)).toBe(false);
        expect(canOpen({ img: 'blob:a' })).toBe(true);
        // A video the torrent can stream is openable without any still frame.
        expect(canOpen({ isVideo: true, torrentFile: {} })).toBe(true);
        expect(canOpen({ isVideo: true, file: new File(['x'], 'a.mp4') })).toBe(true);
    });
});

describe('routeLabel', () => {
    const route = { label: 'p2p nat' };
    it('adds pieces and speed while they move, then falls back to the connection type', () => {
        const state = { rx: 7, tx: 0, rxSpeed: '1.2 MB/sec', at: 1000 };
        expect(routeLabel(route, state, 2000)).toBe('p2p nat · ↓ 7 pieces 1.2 MB/sec');
        expect(routeLabel(route, { rx: 0, tx: 3, at: 1000 }, 2000)).toBe('p2p nat · ↑ 3 pieces');
        expect(routeLabel(route, state, 1000 + 6000)).toBe('p2p nat');
        expect(routeLabel(route, undefined)).toBe('p2p nat');
    });
});
