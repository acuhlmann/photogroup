import React from 'react';
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { createRoot } from 'react-dom/client';
import { act } from 'react';

vi.mock('./replaceOriginal', () => ({
    canChooseFolder: vi.fn(() => true),
    replaceOriginal: vi.fn().mockResolvedValue('replaced'),
    replaceFailureMessage: err => (err && err.cancelled ? '' : 'Could not write that file.'),
}));

const { canChooseFolder, replaceOriginal } = await import('./replaceOriginal');
const { default: ChooseFolderButton, FolderWalk, PlaceThumb } = await import('./saveToChosenFolder');

const tile = (key, extra = {}) => ({
    infoHash: key, tileKey: key, fileName: key + '.jpg', img: 'blob:' + key,
    elem: new Blob(['x']), fileType: 'image/jpeg', loading: false, ...extra,
});

async function render(node) {
    const div = document.createElement('div');
    document.body.appendChild(div);
    const root = createRoot(div);
    await act(async () => root.render(node));
    return { div, root };
}

const press = async (where, label) => {
    const button = Array.from(where.querySelectorAll('button')).find(item => item.textContent === label);
    expect(button, 'no button labelled ' + label).toBeTruthy();
    await act(async () => button.click());
    return button;
};

describe('saveToChosenFolder', () => {
    beforeEach(() => {
        canChooseFolder.mockReturnValue(true);
        replaceOriginal.mockClear();
        replaceOriginal.mockResolvedValue('replaced');
    });

    afterEach(() => {
        document.querySelectorAll('[role="dialog"]').forEach(node => node.remove());
    });

    it('offers nothing where the browser has no save dialog', async () => {
        canChooseFolder.mockReturnValue(false);
        const { div, root } = await render(<ChooseFolderButton tiles={[tile('a'), tile('b')]} />);
        expect(div.textContent).toBe('');
        await act(async () => root.unmount());
    });

    it('sends one photo straight to the save dialog, without an extra screen first', async () => {
        const one = tile('a');
        const { div, root } = await render(<ChooseFolderButton tiles={[one]} device="phone" />);
        expect(div.textContent).toContain('Choose where to save');
        await press(div, 'Choose where to save');
        expect(replaceOriginal).toHaveBeenCalledWith(one);
        expect(document.querySelector('[role="dialog"]')).toBeNull();
        expect(div.textContent).toContain('Saved where you chose');
        await act(async () => root.unmount());
    });

    it('waits for a photo that is still arriving', async () => {
        const { div, root } = await render(<ChooseFolderButton tiles={[tile('a', { loading: true })]} />);
        expect(div.querySelector('button').disabled).toBe(true);
        await act(async () => root.unmount());
    });

    it('says nothing is saved when the dialog is closed', async () => {
        replaceOriginal.mockRejectedValueOnce(Object.assign(new Error('closed'), { cancelled: true }));
        const { div, root } = await render(<ChooseFolderButton tiles={[tile('a')]} />);
        await press(div, 'Choose where to save');
        expect(div.textContent).toContain('Nothing was saved');
        expect(div.textContent).not.toContain('Could not write that file.');
        await act(async () => root.unmount());
    });

    it('walks several photos, asking for a folder once each', async () => {
        const tiles = [tile('a'), tile('b')];
        const { div, root } = await render(<ChooseFolderButton tiles={tiles} device="phone" />);
        await press(div, 'Choose where each one goes');

        const dialog = document.querySelector('[role="dialog"]');
        expect(dialog.textContent).toContain('1 of 2');
        await press(dialog, 'Choose a folder');
        expect(replaceOriginal).toHaveBeenCalledWith(tiles[0]);

        expect(dialog.textContent).toContain('2 of 2');
        await press(dialog, 'Choose a folder');
        expect(replaceOriginal).toHaveBeenCalledWith(tiles[1]);
        await act(async () => root.unmount());
    });

    it('counts the folders already chosen when the walk is opened again', async () => {
        const tiles = [tile('a'), tile('b')];
        const { div, root } = await render(<ChooseFolderButton tiles={tiles} device="phone" />);
        await press(div, 'Choose where each one goes');
        await press(document.querySelector('[role="dialog"]'), 'Choose a folder');
        await press(document.querySelector('[role="dialog"]'), 'Save the rest to your phone');
        expect(div.textContent).toContain('Choose where each one goes (1 left)');

        document.querySelectorAll('[role="dialog"]').forEach(node => node.remove());
        await press(div, 'Choose where each one goes (1 left)');
        const dialog = document.querySelector('[role="dialog"]');
        expect(dialog.textContent).toContain('2 of 2');
        expect(dialog.textContent).toContain('b.jpg');
        await act(async () => root.unmount());
    });

    it('shows the name of the photo waiting for a folder', async () => {
        const tiles = [tile('a', { details: { title: 'Harbour' } }), tile('b')];
        const { div, root } = await render(
            <FolderWalk tiles={tiles} total={2} device="device" onSaved={() => {}} onBack={() => {}} />
        );
        expect(div.textContent).toContain('Harbour');
        expect(div.textContent).toContain('Any folder will do.');
        expect(div.querySelector('[role="dialog"]')).toBeNull();
        await act(async () => root.unmount());
    });

    it('paints the preview a tile already has', async () => {
        const { div, root } = await render(<PlaceThumb tile={tile('a')} />);
        expect(div.querySelector('img').getAttribute('src')).toBe('blob:a');
        await act(async () => root.unmount());
    });
});
