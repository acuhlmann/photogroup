import React from 'react';
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { createRoot } from 'react-dom/client';
import { act } from 'react';

vi.mock('./saveToDevice', () => ({ saveToDevice: vi.fn().mockResolvedValue('saved') }));

const { saveToDevice } = await import('./saveToDevice');
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
        expect(div.textContent).toContain('No photos yet');
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
        await act(async () => viewer.querySelector('[aria-label="Next photo"]').click());
        expect(document.querySelector('[role="dialog"] img').getAttribute('src')).toBe('blob:b');
        await act(async () => root.unmount());
    });
});
