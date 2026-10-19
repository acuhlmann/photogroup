import { beforeEach, describe, expect, it, vi } from 'vitest';

const blob = new Blob([new Uint8Array([0x47, 0x49, 0x46])], { type: 'image/gif' });

function writable(write = vi.fn().mockResolvedValue(undefined)) {
    return {
        write,
        close: vi.fn().mockResolvedValue(undefined),
        abort: vi.fn().mockResolvedValue(undefined),
    };
}

function handleWith(stream = writable()) {
    return {
        kind: 'file',
        createWritable: vi.fn().mockResolvedValue(stream),
    };
}

let replaceOriginal;
let captureDroppedHandles;
let clearOriginalFiles;
let originalReady;
let replaceKind;
let replaceLabel;
let replaceHint;
let replaceFailureMessage;
let attachOriginalHandle;

beforeEach(async () => {
    vi.resetModules();
    delete window.showSaveFilePicker;
    navigator.share = undefined;
    navigator.canShare = undefined;
    ({
        replaceOriginal,
        captureDroppedHandles,
        clearOriginalFiles,
        originalReady,
        replaceKind,
        replaceLabel,
        replaceHint,
        replaceFailureMessage,
        attachOriginalHandle,
    } = await import('./replaceOriginal'));
    clearOriginalFiles();
});

describe('replaceOriginal', () => {
    it('writes over a file the user already granted, without asking again', async () => {
        const stream = writable();
        const handle = handleWith(stream);
        const file = new File([blob], 'a.jpg', { type: 'image/jpeg' });
        attachOriginalHandle(file, handle);
        window.showSaveFilePicker = vi.fn();

        const result = await replaceOriginal({
            elem: blob,
            file,
            fileName: 'a.jpg',
            tileKey: 'k',
        });

        expect(result).toBe('replaced');
        expect(window.showSaveFilePicker).not.toHaveBeenCalled();
        expect(stream.write).toHaveBeenCalledWith(blob);
        expect(stream.close).toHaveBeenCalled();
        expect(originalReady({ tileKey: 'k' })).toBe(true);
    });

    it('asks where to replace, then remembers that file for the next edit', async () => {
        const stream = writable();
        const handle = handleWith(stream);
        window.showSaveFilePicker = vi.fn().mockResolvedValue(handle);
        const tile = {
            elem: blob,
            fileName: 'Camera/IMG_1234.JPG',
            fileType: 'image/jpeg',
            tileKey: 'shot',
            details: { title: 'Dock' },
        };

        expect(replaceLabel(tile)).toBe('Replace original…');
        await replaceOriginal(tile);

        expect(window.showSaveFilePicker).toHaveBeenCalledWith(expect.objectContaining({
            suggestedName: 'IMG_1234.JPG',
            id: 'photogroup-replace',
            startIn: 'pictures',
            types: [{
                description: 'Photo',
                accept: { 'image/jpeg': ['.jpg', '.JPG'] },
            }],
        }));
        expect(stream.write).toHaveBeenCalled();
        expect(replaceLabel(tile)).toBe('Replace original');
        expect(replaceHint(tile)).toContain('over the file you chose');

        window.showSaveFilePicker.mockClear();
        await replaceOriginal(tile);
        expect(window.showSaveFilePicker).not.toHaveBeenCalled();
    });

    it('opens the picker before reading a torrent file, so the gesture still counts', async () => {
        const handle = handleWith();
        let read = false;
        window.showSaveFilePicker = vi.fn(async () => {
            expect(read).toBe(false);
            return handle;
        });

        await replaceOriginal({
            fileName: 'clip.mp4',
            fileType: 'video/mp4',
            tileKey: 'vid',
            torrentFile: {
                getBlob(cb) {
                    read = true;
                    cb(null, blob);
                },
            },
        });

        expect(window.showSaveFilePicker).toHaveBeenCalledWith(expect.objectContaining({
            suggestedName: 'clip.mp4',
            startIn: 'videos',
        }));
        expect(read).toBe(true);
    });

    it('stays quiet when the picker is cancelled', async () => {
        window.showSaveFilePicker = vi.fn().mockRejectedValue(Object.assign(new Error('nope'), { name: 'AbortError' }));
        const err = await replaceOriginal({ elem: blob, fileName: 'a.jpg', tileKey: 'c' }).catch(e => e);
        expect(err.cancelled).toBe(true);
        expect(replaceFailureMessage(err)).toBe('');
    });

    it('discards a partial write and forgets a file that cannot be changed', async () => {
        const stream = writable(vi.fn().mockRejectedValue(Object.assign(new Error('ro'), { name: 'NoModificationAllowedError' })));
        const handle = {
            kind: 'file',
            queryPermission: vi.fn().mockResolvedValue('granted'),
            createWritable: vi.fn().mockResolvedValue(stream),
        };
        const file = new File([blob], 'a.jpg', { type: 'image/jpeg' });
        attachOriginalHandle(file, handle);
        const tile = { elem: blob, file, fileName: 'a.jpg', tileKey: 'ro' };

        await expect(replaceOriginal(tile)).rejects.toMatchObject({ name: 'NoModificationAllowedError' });
        expect(stream.abort).toHaveBeenCalled();
        expect(stream.close).not.toHaveBeenCalled();
        expect(originalReady(tile)).toBe(false);

        const next = handleWith();
        window.showSaveFilePicker = vi.fn().mockResolvedValue(next);
        await replaceOriginal(tile);
        expect(window.showSaveFilePicker).toHaveBeenCalled();
    });

    it('shares a same-named file when the browser cannot write one in place', async () => {
        const shared = vi.fn().mockResolvedValue(undefined);
        navigator.share = shared;
        navigator.canShare = vi.fn().mockReturnValue(true);
        const tile = { elem: blob, fileName: 'folder/harbor.jpg', fileType: 'image/jpeg', details: { title: 'Harbor' } };

        expect(replaceKind()).toBe('share');
        expect(replaceLabel(tile)).toBe('Save to Files');
        expect(replaceHint(tile)).toContain('same folder');

        await expect(replaceOriginal(tile)).resolves.toBe('shared');
        const payload = shared.mock.calls[0][0];
        expect(payload.files[0].name).toBe('harbor.jpg');
        expect(payload.title).toBe('Harbor');
        expect(replaceLabel(tile, { replaced: 'shared' })).toBe('Saved');
    });

    it('reports a browser that cannot share files either', async () => {
        navigator.share = vi.fn();
        navigator.canShare = vi.fn().mockReturnValue(false);
        expect(replaceKind()).toBe(null);
        await expect(replaceOriginal({ elem: blob, fileName: 'a.jpg' }))
            .rejects.toThrow(/cannot put the file back/);
    });
});

describe('captureDroppedHandles', () => {
    it('keeps the dropped file handle on the file that will be seeded', async () => {
        const file = new File(['a'], 'a.jpg', { type: 'image/jpeg' });
        const handle = handleWith();
        const dataTransfer = {
            files: [file],
            items: [{
                kind: 'file',
                getAsFileSystemHandle: vi.fn().mockResolvedValue(handle),
            }, {
                kind: 'string',
            }],
        };

        await captureDroppedHandles(dataTransfer);

        expect(originalReady({ file, tileKey: 'drop' })).toBe(true);
    });
});
