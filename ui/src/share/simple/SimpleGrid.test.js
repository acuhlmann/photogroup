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
    canChooseFolder: vi.fn(() => false),
    replaceOriginal: vi.fn().mockResolvedValue('replaced'),
    replaceFailureMessage: () => 'Could not write that file.',
    replaceHint: count => `Pick the folder ${count === 1 ? 'this goes' : 'they go'} into. On a phone, DCIM/Camera is your gallery.`,
}));

const { saveToDevice } = await import('../gallery/saveToDevice');
const { replaceOriginal, canChooseFolder } = await import('../gallery/replaceOriginal');
const { default: SimpleGrid } = await import('./SimpleGrid');
const { clearHave, rememberHave } = await import('../gallery/alreadyHave');

const ready = (key, extra = {}) => ({
    infoHash: key, tileKey: key, fileName: key + '.jpg', img: 'blob:' + key,
    elem: new Blob(['x']), loading: false, fingerprint: '1:' + key.padEnd(64, '0'), ...extra,
});

async function render(tiles, props = {}) {
    const div = document.createElement('div');
    document.body.appendChild(div);
    const root = createRoot(div);
    await act(async () => root.render(<SimpleGrid tiles={tiles} roomId="r1" {...props} />));
    return { div, root };
}

const buttons = div => Array.from(div.querySelectorAll('button')).map(button => button.textContent);

describe('SimpleGrid', () => {
    beforeEach(() => {
        clearHave();
        saveToDevice.mockClear();
        replaceOriginal.mockClear();
        canChooseFolder.mockReturnValue(false);
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
        expect(buttons(div)).toEqual(expect.arrayContaining(['Save all 2 new', 'Save', 'Yours']));
        // One room-wide save, and one line that says where it goes.
        expect(buttons(div).filter(text => /^Save all|^Choose/.test(text))).toEqual(['Save all 2 new']);
        expect(div.querySelector('[data-testid="saved-where"]').textContent).toBe('It goes to your gallery app.');

        const saveAll = Array.from(div.querySelectorAll('button')).find(button => button.textContent === 'Save all 2 new');
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
        expect(buttons(div).some(text => text.startsWith('Save all'))).toBe(false);
        await act(async () => root.unmount());
    });

    it('gives every photo a Remove button', async () => {
        const onRemove = vi.fn();
        const tiles = [ready('a'), ready('b')];
        const { div, root } = await render(tiles, { onRemove });
        await act(async () => div.querySelector('[aria-label="Remove b.jpg"]').click());
        expect(onRemove).toHaveBeenCalledWith(tiles[1]);
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

    // One Save per photo: no second save button.
    it('gives a looked-at photo one Save button and says where it goes', async () => {
        const { div, root } = await render([ready('a'), ready('b')]);
        await act(async () => div.querySelector('[aria-label="Look at this photo"]').click());
        const viewer = document.querySelector('[role="dialog"]');
        expect(Array.from(viewer.querySelectorAll('button')).map(b => b.textContent).filter(t => /save/i.test(t))).toEqual(['Save']);
        expect(viewer.textContent).toContain('It goes to your gallery app.');
        await act(async () => root.unmount());
    });

    // Where the browser has a save dialog, the same one Save opens it, so the
    // person picks the folder and knows where to find the photo.
    it('lets Save pick the folder where the browser can', async () => {
        canChooseFolder.mockReturnValue(true);
        const tiles = [ready('a'), ready('b')];
        const { div, root } = await render(tiles);
        expect(div.querySelector('[data-testid="saved-where"]').textContent).toContain('DCIM/Camera');
        expect(buttons(div)).toContain('Save all 2 new');

        const save = Array.from(div.querySelectorAll('button')).find(button => button.textContent === 'Save');
        await act(async () => save.click());
        expect(replaceOriginal).toHaveBeenCalledWith(tiles[0]);
        expect(saveToDevice).not.toHaveBeenCalled();

        await act(async () => div.querySelector('[aria-label="Look at this photo"]').click());
        const viewer = document.querySelector('[role="dialog"]');
        expect(viewer.textContent).toContain('DCIM/Camera');
        await act(async () => root.unmount());
    });

    it('saves all new ones one save dialog at a time where the browser can', async () => {
        canChooseFolder.mockReturnValue(true);
        const tiles = [ready('a'), ready('b')];
        const { div, root } = await render(tiles);
        const saveAll = Array.from(div.querySelectorAll('button')).find(button => button.textContent === 'Save all 2 new');
        await act(async () => saveAll.click());
        const walk = document.querySelector('[data-testid="folder-walk"]');
        expect(walk.textContent).toContain('1 of 2');
        expect(saveToDevice).not.toHaveBeenCalled();
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
});
