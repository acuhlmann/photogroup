import React from 'react';
import { describe, it, expect, vi } from 'vitest';
import { createRoot } from 'react-dom/client';
import { act } from 'react';
import EventEmitter from 'eventemitter3';
import NetworkStage from './NetworkStage';
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
        await act(async () => root.render(<NetworkStage master={master} tiles={tiles} onOpenPhoto={onOpenPhoto} />));
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
        await act(async () => root.render(<NetworkStage master={master} tiles={[]} onOpenPhoto={() => {}} />));
        const file = new File(['x'], 'a.jpg', { type: 'image/jpeg' });
        const drop = new Event('drop', { bubbles: true });
        drop.dataTransfer = { files: [file] };
        await act(async () => div.firstChild.dispatchEvent(drop));
        expect(onFiles).toHaveBeenCalledWith([file]);
        await act(async () => root.unmount());
    });
});
