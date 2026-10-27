import React from 'react';
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { createRoot } from 'react-dom/client';
import { act } from 'react';

vi.mock('./saveRoom', async original => ({ ...(await original()), saveRoom: vi.fn() }));

const { saveRoom } = await import('./saveRoom');
const { default: DownloadRoomButton } = await import('./DownloadRoomButton');
const { clearHave } = await import('./alreadyHave');
const { fingerprintFile } = await import('./fingerprint');

const ready = { elem: new Blob([]), fileName: 'a.jpg' };
const arriving = { fileName: 'b.jpg', torrentFile: { done: false, getBlob() {} } };

async function render(tiles) {
    const div = document.createElement('div');
    document.body.appendChild(div);
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
        expect(div.querySelector('[role="status"]').textContent).toBe('Saved 1 photo · 1 not ready, not included');
        expect(button.disabled).toBe(false);
        await act(async () => root.unmount());
    });

    it('waits until a photo is here in full', async () => {
        const { root, button } = await render([arriving]);
        expect(button.disabled).toBe(true);
        await act(async () => root.unmount());
    });

    describe('photos you already have', () => {
        beforeEach(() => clearHave());

        const menuItem = text => Array.from(document.body.querySelectorAll('[role="menuitem"]'))
            .find(item => item.textContent.startsWith(text));
        const openMenu = div => act(async () => div.querySelector('button[aria-label="More download options"]').click());

        it('leaves out photos you shared, and says so', async () => {
            saveRoom.mockResolvedValueOnce({ saved: 1, skipped: 0 });
            const mine = { elem: new Blob([]), fileName: 'mine.jpg', seed: true };
            const { div, root, button } = await render([mine, ready]);
            expect(button.textContent).toBe('Download 1 new');
            await act(async () => button.click());
            expect(saveRoom).toHaveBeenLastCalledWith([ready], expect.anything());
            expect(div.querySelector('[role="status"]').textContent).toBe('Saved 1 photo · 1 you have, not included');
            await act(async () => root.unmount());
        });

        it('can still download everything', async () => {
            saveRoom.mockResolvedValueOnce({ saved: 1, skipped: 0 });
            const mine = { elem: new Blob([]), fileName: 'mine.jpg', seed: true };
            const { div, root, button } = await render([mine]);
            expect(button.textContent).toBe('You have them all');
            expect(button.disabled).toBe(true);
            await openMenu(div);
            await act(async () => menuItem('Download all 1').click());
            expect(saveRoom).toHaveBeenLastCalledWith([mine], expect.anything());
            await act(async () => root.unmount());
        });

        it('finds photos in a folder you pick and stops offering them', async () => {
            const original = new File(['the original bytes'], 'IMG_0042.JPG');
            const photo = { elem: original, fileName: 'IMG_0042.JPG', fingerprint: await fingerprintFile(original) };
            window.showDirectoryPicker = vi.fn().mockResolvedValue({
                kind: 'directory',
                name: 'Camera',
                async *values() {
                    yield { kind: 'file', name: 'renamed.jpg', getFile: async () => new File(['the original bytes'], 'renamed.jpg') };
                },
            });
            const { div, root, button } = await render([photo, ready]);
            expect(button.textContent).toBe('Download room');

            await openMenu(div);
            await act(async () => menuItem('Find the ones on this device').click());

            await vi.waitFor(() => expect(div.querySelector('[role="status"]').textContent)
                .toBe('Found 1 photo already on this device'));
            expect(button.textContent).toBe('Download 1 new');
            delete window.showDirectoryPicker;
            await act(async () => root.unmount());
        });

        it("can't look for photos shared before fingerprints existed", async () => {
            const { div, root } = await render([ready]);
            await openMenu(div);
            expect(menuItem('Find the ones on this device').getAttribute('aria-disabled')).toBe('true');
            await act(async () => root.unmount());
        });
    });

    describe('where the zip goes', () => {
        const menuItem = text => Array.from(document.body.querySelectorAll('[role="menuitem"]'))
            .find(item => item.textContent.startsWith(text));
        const openMenu = div => act(async () => div.querySelector('button[aria-label="More download options"]').click());
        // The picker is a global, cleaned up here so one test's failure cannot
        // leave the next one seeing a dialog it never asked for.
        afterEach(() => { delete window.showSaveFilePicker; });

        // The browser opens the save dialog only on a fresh tap, so the ask has
        // to come before the zip: building it photo by photo can outlast the tap.
        it('asks where the zip goes before the room is zipped, and writes into that file', async () => {
            const order = [];
            const stream = {
                write: vi.fn().mockResolvedValue(undefined),
                close: vi.fn().mockResolvedValue(undefined),
                abort: vi.fn(),
            };
            window.showSaveFilePicker = vi.fn(() => {
                order.push('dialog');
                return Promise.resolve({ kind: 'file', createWritable: vi.fn().mockResolvedValue(stream) });
            });
            const zip = new Blob(['zip']);
            saveRoom.mockImplementationOnce((tiles, { save }) => {
                order.push('zip');
                // The room is zipped only after the folder was chosen, and the
                // bytes then go into the file the dialog handed back.
                return Promise.resolve(save(zip, 'photogroup-r1.zip', 'application/zip'))
                    .then(() => ({ saved: 1, skipped: 0 }));
            });

            const { div, root } = await render([ready]);
            await openMenu(div);
            await act(async () => menuItem('Save the zip where I choose').click());

            await vi.waitFor(() => expect(div.querySelector('[role="status"]').textContent).toBe('Saved 1 photo where you chose'));
            expect(order).toEqual(['dialog', 'zip']);
            expect(saveRoom).toHaveBeenLastCalledWith([ready], expect.objectContaining({ save: expect.any(Function) }));
            expect(stream.write).toHaveBeenCalledWith(zip);
            expect(stream.close).toHaveBeenCalled();
            await act(async () => root.unmount());
        });

        it('does not zip the room when the folder is refused', async () => {
            window.showSaveFilePicker = vi.fn().mockRejectedValue(Object.assign(new Error('closed'), { name: 'AbortError' }));
            const { div, root } = await render([ready]);
            await openMenu(div);
            await act(async () => menuItem('Save the zip where I choose').click());

            await vi.waitFor(() => expect(div.querySelector('[role="status"]').textContent).toBe('Nothing was saved'));
            expect(saveRoom).not.toHaveBeenCalled();
            await act(async () => root.unmount());
        });

        it('offers it only where that dialog exists', async () => {
            const { div, root } = await render([ready]);
            await openMenu(div);
            expect(menuItem('Save the zip where I choose')).toBeUndefined();
            await act(async () => root.unmount());
        });
    });
});
