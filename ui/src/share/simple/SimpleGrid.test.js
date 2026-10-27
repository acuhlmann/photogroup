import React from 'react';
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { createRoot } from 'react-dom/client';
import { act } from 'react';

vi.mock('../gallery/saveToDevice', () => ({
    saveToDevice: vi.fn().mockResolvedValue('saved'),
    savedWhereText: () => 'It goes to your gallery app.',
    saveWay: () => 'each',
}));

// The folder walk asks the browser's save dialog for a place; this stands in
// for that dialog so the wiring, not the dialog, is under test.
vi.mock('../gallery/replaceOriginal', () => ({
    canChooseFolder: vi.fn(() => true),
    replaceOriginal: vi.fn().mockResolvedValue('replaced'),
    replaceFailureMessage: () => 'Could not write that file.',
}));

const { saveToDevice } = await import('../gallery/saveToDevice');
const { replaceOriginal } = await import('../gallery/replaceOriginal');
const { default: SimpleGrid } = await import('./SimpleGrid');
const { clearHave, rememberHave } = await import('../gallery/alreadyHave');

const ready = (key, extra = {}) => ({
    infoHash: key, tileKey: key, fileName: key + '.jpg', img: 'blob:' + key,
    elem: new Blob(['x']), loading: false, fingerprint: '1:' + key.padEnd(64, '0'), ...extra,
});

async function render(tiles) {
    const div = document.createElement('div');
    document.body.appendChild(div);
    const root = createRoot(div);
    await act(async () => root.render(<SimpleGrid tiles={tiles} roomId="r1" />));
    return { div, root };
}

const buttons = div => Array.from(div.querySelectorAll('button')).map(button => button.textContent);

describe('SimpleGrid', () => {
    beforeEach(() => {
        clearHave();
        saveToDevice.mockClear();
    });

    it('says what happens when there are no photos yet', async () => {
        const { div, root } = await render([]);
        expect(div.textContent).toContain('No photos or clips yet');
        await act(async () => root.unmount());
    });

    it('gives every photo a Save button, and saves new ones all at once', async () => {
        const tiles = [ready('a'), ready('b'), ready('c', { seed: true })];
        const { div, root } = await render(tiles);
        expect(div.textContent).toContain('3 photos');
        expect(buttons(div)).toEqual(expect.arrayContaining(['Save all 2', 'Save', 'Yours']));

        const saveAll = Array.from(div.querySelectorAll('button')).find(button => button.textContent === 'Save all 2');
        await act(async () => saveAll.click());
        expect(saveToDevice).toHaveBeenCalledWith([tiles[0], tiles[1]], { roomId: 'r1' });
        await act(async () => root.unmount());
    });

    it('marks saved photos and shows progress for ones still arriving', async () => {
        const saved = ready('a');
        rememberHave(saved.fingerprint, 'saved');
        const arriving = { infoHash: 'b', fileName: 'b.jpg', loading: true, torrentFile: { progress: 0.42 } };
        const { div, root } = await render([saved, arriving]);
        expect(buttons(div)).toContain('Saved');
        expect(div.textContent).toContain('Arriving · 42%');
        expect(buttons(div)).not.toContain('Save all 1');
        await act(async () => root.unmount());
    });

    it('opens a photo full screen with its own Save button', async () => {
        const { div, root } = await render([ready('a'), ready('b')]);
        await act(async () => div.querySelector('[aria-label="Look at this photo"]').click());
        const viewer = document.querySelector('[role="dialog"]');
        expect(viewer.querySelector('img').getAttribute('src')).toBe('blob:a');
        await act(async () => viewer.querySelector('[aria-label="Next"]').click());
        expect(document.querySelector('[role="dialog"] img').getAttribute('src')).toBe('blob:b');
        await act(async () => root.unmount());
    });

    // The phone path: on the big screen a photo gets the save dialog too, so it
    // can be aimed at DCIM/Camera rather than only the Download folder.
    it('offers to choose where a looked-at photo goes', async () => {
        const tiles = [ready('a'), ready('b')];
        const { div, root } = await render(tiles);
        expect(div.textContent).not.toContain('Choose where to save');
        await act(async () => div.querySelector('[aria-label="Look at this photo"]').click());

        const viewer = document.querySelector('[role="dialog"]');
        const place = Array.from(viewer.querySelectorAll('button')).find(b => b.textContent === 'Choose where to save');
        await act(async () => place.click());
        expect(replaceOriginal).toHaveBeenCalledWith(tiles[0]);
        expect(document.querySelector('[role="dialog"]').textContent).toContain('Saved where you chose');
        await act(async () => root.unmount());
    });

    it('shows a clip by its poster frame, counts it as a clip and plays it full screen', async () => {
        const clip = ready('c', { fileName: 'c.mp4', img: null, isVideo: true, fileType: 'video/mp4', previewUrl: 'blob:poster' });
        const { div, root } = await render([ready('a'), clip]);
        expect(div.textContent).toContain('1 photo and 1 clip');
        const play = div.querySelector('[aria-label="Play this clip"]');
        expect(play.querySelector('img').getAttribute('src')).toBe('blob:poster');
        await act(async () => play.click());
        const video = document.querySelector('[role="dialog"] video');
        expect(video.getAttribute('poster')).toBe('blob:poster');
        await act(async () => root.unmount());
    });

    it('shows the poster of a clip still arriving under its progress', async () => {
        const arriving = {
            infoHash: 'v', fileName: 'v.mp4', isVideo: true, loading: true,
            torrentFile: { progress: 0.5 },
            torrentFileThumb: { blob: async () => new Blob(['jpeg']) },
        };
        URL.createObjectURL = URL.createObjectURL || (() => 'blob:x');
        const { div, root } = await render([arriving]);
        await act(async () => {});
        expect(div.textContent).toContain('Arriving · 50%');
        expect(div.querySelector('img')).not.toBeNull();
        expect(div.querySelector('[aria-label="Play this clip"]')).toBeNull();
        await act(async () => root.unmount());
    });

    it('puts photos from other people first', async () => {
        const { div, root } = await render([ready('mine', { seed: true }), ready('theirs')]);
        const pictures = Array.from(div.querySelectorAll('[data-testid="simple-tile"] img')).map(img => img.getAttribute('src'));
        expect(pictures).toEqual(['blob:theirs', 'blob:mine']);
        await act(async () => root.unmount());
    });

    it('goes through the new photos to keep or skip each, then saves the kept ones', async () => {
        const tiles = [ready('a'), ready('b'), ready('c'), ready('mine', { seed: true })];
        const { div, root } = await render(tiles);
        const choose = Array.from(div.querySelectorAll('button')).find(button => button.textContent.startsWith('Choose what to save'));
        expect(choose.textContent).toBe('Choose what to save (3)');
        await act(async () => choose.click());

        const dialog = () => document.querySelector('[role="dialog"]');
        const press = async label => {
            const button = Array.from(dialog().querySelectorAll('button')).find(item => item.textContent === label);
            await act(async () => button.click());
        };
        expect(dialog().textContent).toContain('1 of 3');
        expect(dialog().querySelector('[data-testid="media-stage"] img').getAttribute('src')).toBe('blob:a');
        await press('Keep');
        expect(dialog().textContent).toContain('2 of 3');
        await press('Skip');
        await press('Keep');
        expect(dialog().textContent).toContain('You kept 2 of 3');
        expect(dialog().textContent).toContain('It goes to your gallery app.');
        await press('Save 2 photos to your phone');
        expect(saveToDevice).toHaveBeenCalledWith([tiles[0], tiles[2]], expect.objectContaining({ roomId: 'r1' }));
        expect(dialog().textContent).toContain('Saved 2 photos');
        await act(async () => root.unmount());
    });
});
