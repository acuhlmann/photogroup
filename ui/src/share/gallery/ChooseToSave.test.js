import React from 'react';
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { createRoot } from 'react-dom/client';
import { act } from 'react';

vi.mock('./saveToDevice', () => ({
    saveToDevice: vi.fn().mockResolvedValue('saved'),
    savedWhereText: (count, options) => (options && options.way === 'chosen' ? 'CHOSEN' : 'DOWNLOADED'),
    saveWay: () => 'each',
}));

vi.mock('./replaceOriginal', () => ({
    replaceKind: vi.fn(() => 'file'),
    canChooseFolder: vi.fn(() => true),
    replaceOriginal: vi.fn().mockResolvedValue('replaced'),
    replaceFailureMessage: err => (err && err.cancelled ? '' : 'Could not write that file.'),
}));

const { saveToDevice } = await import('./saveToDevice');
const { canChooseFolder, replaceOriginal } = await import('./replaceOriginal');
const { clearHave } = await import('./alreadyHave');
const { LookThrough } = await import('./ChooseToSave');

const tile = key => ({
    infoHash: key, tileKey: key, fileName: key + '.jpg', img: 'blob:' + key,
    elem: new Blob(['x']), fileType: 'image/jpeg', loading: false, fingerprint: '1:' + key.padEnd(64, '0'),
});

async function open(tiles, device = 'phone') {
    const div = document.createElement('div');
    document.body.appendChild(div);
    const root = createRoot(div);
    const closed = vi.fn();
    await act(async () => {
        root.render(<LookThrough tiles={tiles} keys={tiles.map(item => item.tileKey)} roomId="r1" device={device} onClose={closed} />);
    });
    return { div, root, closed, dialog: () => document.querySelector('[role="dialog"]') };
}

const press = async (within, label) => {
    const button = Array.from(within().querySelectorAll('button')).find(item => item.textContent === label);
    expect(button, 'no button labelled ' + label).toBeTruthy();
    await act(async () => button.click());
    return button;
};

describe('Choose what to save: picking the folder', () => {
    let tiles;

    beforeEach(() => {
        clearHave();
        saveToDevice.mockClear();
        replaceOriginal.mockClear();
        replaceOriginal.mockResolvedValue('replaced');
        canChooseFolder.mockReturnValue(true);
        tiles = [tile('a'), tile('b')];
    });

    afterEach(() => {
        document.querySelectorAll('[role="dialog"]').forEach(node => node.remove());
    });

    /** Keep both photos and land on the "You kept 2 of 2" screen. */
    async function keptBoth(view) {
        await press(view.dialog, 'Keep');
        await press(view.dialog, 'Keep');
        expect(view.dialog().textContent).toContain('You kept 2 of 2');
    }

    it('offers the folder choice beside the one-tap save', async () => {
        const view = await open(tiles);
        await keptBoth(view);
        expect(view.dialog().textContent).toContain('Save 2 photos to your phone');
        expect(view.dialog().textContent).toContain('Choose where each one goes');
        await act(async () => view.root.unmount());
    });

    it('hides it when the browser has no save dialog', async () => {
        canChooseFolder.mockReturnValue(false);
        const view = await open(tiles);
        await keptBoth(view);
        expect(view.dialog().textContent).not.toContain('Choose where each one goes');
        expect(view.dialog().textContent).toContain('Save 2 photos to your phone');
        await act(async () => view.root.unmount());
    });

    it('asks for a folder once per photo, then says they are where they were told', async () => {
        const view = await open(tiles);
        await keptBoth(view);
        await press(view.dialog, 'Choose where each one goes');

        expect(view.dialog().textContent).toContain('1 of 2');
        expect(view.dialog().textContent).toContain('a.jpg');
        await press(view.dialog, 'Choose a folder');
        expect(replaceOriginal).toHaveBeenCalledWith(tiles[0]);

        // The next one is up, so every tap carries its own user gesture.
        expect(view.dialog().textContent).toContain('2 of 2');
        expect(view.dialog().textContent).toContain('b.jpg');
        await press(view.dialog, 'Choose a folder');
        expect(replaceOriginal).toHaveBeenCalledWith(tiles[1]);

        expect(view.dialog().textContent).toContain('Saved 2 photos');
        expect(view.dialog().textContent).toContain('CHOSEN');
        expect(saveToDevice).not.toHaveBeenCalled();
        await act(async () => view.root.unmount());
    });

    it('saves only the ones with no chosen folder after a part-filled walk', async () => {
        const view = await open(tiles);
        await keptBoth(view);
        await press(view.dialog, 'Choose where each one goes');
        await press(view.dialog, 'Choose a folder');
        expect(replaceOriginal).toHaveBeenCalledTimes(1);

        await press(view.dialog, 'Save the rest to your phone');
        expect(view.dialog().textContent).toContain('Save 1 photo to your phone');
        await press(view.dialog, 'Save 1 photo to your phone');
        expect(saveToDevice).toHaveBeenCalledWith([tiles[1]], expect.objectContaining({ roomId: 'r1' }));
        expect(view.dialog().textContent).toContain('Saved 2 photos');
        expect(view.dialog().textContent).toContain('DOWNLOADED');
        expect(view.dialog().textContent).toContain('CHOSEN');
        await act(async () => view.root.unmount());
    });

    it('stays put when the save dialog is closed without choosing', async () => {
        replaceOriginal.mockRejectedValue(Object.assign(new Error('closed'), { name: 'AbortError', cancelled: true }));
        const view = await open(tiles);
        await keptBoth(view);
        await press(view.dialog, 'Choose where each one goes');
        await press(view.dialog, 'Choose a folder');
        expect(view.dialog().textContent).toContain('1 of 2');
        expect(view.dialog().textContent).toContain('Save the rest to your phone');
        await act(async () => view.root.unmount());
    });

    it('reports a write that the browser refused', async () => {
        replaceOriginal.mockRejectedValue(Object.assign(new Error('no'), { name: 'NotAllowedError' }));
        const view = await open(tiles);
        await keptBoth(view);
        await press(view.dialog, 'Choose where each one goes');
        await press(view.dialog, 'Choose a folder');
        expect(view.dialog().textContent).toContain('Could not write that file.');
        expect(view.dialog().textContent).toContain('1 of 2');
        await act(async () => view.root.unmount());
    });
});
