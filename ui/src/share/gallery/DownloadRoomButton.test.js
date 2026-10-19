import React from 'react';
import { describe, it, expect, vi } from 'vitest';
import { createRoot } from 'react-dom/client';
import { act } from 'react';

vi.mock('./saveRoom', async original => ({ ...(await original()), saveRoom: vi.fn() }));

const { saveRoom } = await import('./saveRoom');
const { default: DownloadRoomButton } = await import('./DownloadRoomButton');

const ready = { elem: new Blob([]), fileName: 'a.jpg' };
const arriving = { fileName: 'b.jpg', torrentFile: { done: false, getBlob() {} } };

async function render(tiles) {
    const div = document.createElement('div');
    const root = createRoot(div);
    await act(async () => root.render(<DownloadRoomButton tiles={tiles} roomId="r1" />));
    return { div, root, button: div.querySelector('button') };
}

describe('DownloadRoomButton', () => {
    it('zips the room, showing progress and then what was saved', async () => {
        let finish;
        saveRoom.mockImplementationOnce((tiles, { onProgress }) => {
            onProgress(1, 1);
            return new Promise(resolve => { finish = resolve; });
        });
        const { div, root, button } = await render([ready, arriving]);
        expect(button.textContent).toBe('Download room');
        await act(async () => button.click());
        expect(saveRoom).toHaveBeenCalledWith([ready, arriving], expect.objectContaining({ roomId: 'r1' }));
        expect(button.textContent).toBe('Zipping 1 of 1…');
        expect(button.disabled).toBe(true);
        await act(async () => finish({ saved: 1, skipped: 1 }));
        expect(div.querySelector('[role="status"]').textContent).toBe('Saved 1 photo · 1 not ready, left out');
        expect(button.disabled).toBe(false);
        await act(async () => root.unmount());
    });

    it('waits until a photo is here in full', async () => {
        const { root, button } = await render([arriving]);
        expect(button.disabled).toBe(true);
        await act(async () => root.unmount());
    });
});
