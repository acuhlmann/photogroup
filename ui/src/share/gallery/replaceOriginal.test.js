import { beforeEach, describe, expect, it, vi } from 'vitest';

let primePhotoCopy;

const blob = new Blob([new Uint8Array([0x47, 0x49, 0x46])], { type: 'image/gif' });

function copyReadsSettled() {
    return new Promise(resolve => setTimeout(resolve, 0));
}

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
let clearOriginalFiles;
let replaceKind;
let replaceLabel;
let replaceHint;
let replaceFailureMessage;

beforeEach(async () => {
    vi.resetModules();
    delete window.showSaveFilePicker;
    navigator.share = undefined;
    navigator.canShare = undefined;
    ({
        replaceOriginal,
        clearOriginalFiles,
        replaceKind,
        replaceLabel,
        replaceHint,
        replaceFailureMessage,
        primePhotoCopy,
    } = await import('./replaceOriginal'));
    clearOriginalFiles();
});

describe('replaceOriginal', () => {
    it('asks where to save every time, and never writes over a file on its own', async () => {
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

        expect(replaceLabel(tile)).toBe('Choose where to save…');
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
        expect(replaceLabel(tile)).toBe('Choose where to save…');
        expect(replaceLabel(tile, { replaced: 'replaced' })).toBe('Saved');

        window.showSaveFilePicker.mockClear();
        await replaceOriginal(tile);
        expect(window.showSaveFilePicker).toHaveBeenCalledTimes(1);
    });

    it('names the choice the same for photos shared from here and received', () => {
        window.showSaveFilePicker = vi.fn();
        const received = { elem: blob, fileName: 'dock.jpg', fileType: 'image/jpeg', tileKey: 'theirs' };
        const shared = { elem: blob, fileName: 'dock.jpg', fileType: 'image/jpeg', tileKey: 'mine', seed: true };

        expect(replaceLabel(shared)).toBe('Choose where to save…');
        expect(replaceLabel(received)).toBe('Choose where to save…');
        expect(replaceHint()).toContain('DCIM/Camera');
    });

    it('starts reading a torrent file before the save dialog returns', async () => {
        const handle = handleWith();
        let read = false;
        window.showSaveFilePicker = vi.fn(async () => {
            expect(read).toBe(true);
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

    it('copies the photo before opening the destination, so picking the file it came from is safe', async () => {
        const bytes = new Uint8Array([1, 2, 3, 4]);
        const file = new File([bytes], 'harbor.jpg', { type: 'image/jpeg' });
        let opened = false;
        file.arrayBuffer = vi.fn(async () => {
            if (opened) {
                const err = new Error('The requested file could not be read, typically due to permission problems that have occurred after a reference to a file was acquired.');
                err.name = 'NotReadableError';
                throw err;
            }
            return bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength);
        });
        const stream = writable();
        const handle = {
            kind: 'file',
            createWritable: vi.fn(async () => {
                opened = true;
                return stream;
            }),
        };
        window.showSaveFilePicker = vi.fn().mockResolvedValue(handle);

        await replaceOriginal({ elem: file, fileName: 'harbor.jpg', fileType: 'image/jpeg', tileKey: 'same' });

        expect(stream.close).toHaveBeenCalled();
        const written = stream.write.mock.calls[0][0];
        expect(written).not.toBe(file);
        expect(new Uint8Array(await written.arrayBuffer())).toEqual(bytes);
    });

    it('uses a copy taken before the save dialog truncates the uploaded file', async () => {
        const bytes = new Uint8Array([9, 8, 7, 6, 5]);
        const file = new File([bytes], 'evening.jpg', { type: 'image/jpeg' });
        let truncated = false;
        const read = file.arrayBuffer.bind(file);
        file.arrayBuffer = vi.fn(async () => {
            if (truncated) {
                const err = new Error('gone');
                err.name = 'NotReadableError';
                throw err;
            }
            return read();
        });
        const stream = writable();
        window.showSaveFilePicker = vi.fn(async () => {
            truncated = true;
            return handleWith(stream);
        });
        const tile = {
            elem: file,
            fileName: 'evening.jpg',
            fileType: 'image/jpeg',
            tileKey: 'evening',
            details: { title: 'Evening harbor' },
        };

        primePhotoCopy(tile);
        await copyReadsSettled();
        await replaceOriginal(tile);

        const written = stream.write.mock.calls[0][0];
        expect(new Uint8Array(await written.arrayBuffer())).toEqual(bytes);
    });

    it('starts reading the photo before the save dialog can return', async () => {
        const bytes = new Uint8Array([1, 2, 3, 4]);
        const file = new File([bytes], 'evening.jpg', { type: 'image/jpeg' });
        let started = false;
        file.arrayBuffer = vi.fn(async () => {
            started = true;
            return bytes.buffer.slice(0);
        });
        const stream = writable();
        window.showSaveFilePicker = vi.fn(async () => {
            expect(started).toBe(true);
            return handleWith(stream);
        });

        await replaceOriginal({
            elem: file,
            fileName: 'evening.jpg',
            fileType: 'image/jpeg',
            tileKey: 'fresh',
        });

        expect(stream.close).toHaveBeenCalled();
    });

    it('stays quiet when the picker is cancelled', async () => {
        window.showSaveFilePicker = vi.fn().mockRejectedValue(Object.assign(new Error('nope'), { name: 'AbortError' }));
        const err = await replaceOriginal({ elem: blob, fileName: 'a.jpg', tileKey: 'c' }).catch(e => e);
        expect(err.cancelled).toBe(true);
        expect(replaceFailureMessage(err)).toBe('');
    });

    it('discards a partial write', async () => {
        const stream = writable(vi.fn().mockRejectedValue(Object.assign(new Error('ro'), { name: 'NoModificationAllowedError' })));
        window.showSaveFilePicker = vi.fn().mockResolvedValue(handleWith(stream));
        const tile = { elem: blob, fileName: 'a.jpg', tileKey: 'ro' };

        await expect(replaceOriginal(tile)).rejects.toMatchObject({ name: 'NoModificationAllowedError' });
        expect(stream.abort).toHaveBeenCalled();
        expect(stream.close).not.toHaveBeenCalled();
    });

    it('opens the share sheet when the browser has no save dialog', async () => {
        const shared = vi.fn().mockResolvedValue(undefined);
        navigator.share = shared;
        navigator.canShare = vi.fn().mockReturnValue(true);
        const tile = { elem: blob, fileName: 'folder/harbor.jpg', fileType: 'image/jpeg', details: { title: 'Harbor' } };

        expect(replaceKind()).toBe('share');
        expect(replaceLabel(tile)).toBe('Save to Files');
        expect(replaceHint()).toContain('Pick the folder');

        await expect(replaceOriginal(tile)).resolves.toBe('shared');
        const payload = shared.mock.calls[0][0];
        expect(payload.files[0].name).toBe('harbor.jpg');
        expect(payload.title).toBe('Harbor');
        expect(replaceLabel(tile, { replaced: 'shared' })).toBe('Saved');
    });

    it('remembers a photo once it is saved, not when the picker is cancelled', async () => {
        const { alreadyHave, clearHave } = await import('./alreadyHave');
        clearHave();
        const written = { elem: blob, fileName: 'a.jpg', tileKey: 'w', fingerprint: '3:' + 'a'.repeat(64) };
        const cancelled = { elem: blob, fileName: 'b.jpg', tileKey: 'x', fingerprint: '3:' + 'b'.repeat(64) };
        window.showSaveFilePicker = vi.fn()
            .mockResolvedValueOnce(handleWith())
            .mockRejectedValueOnce(Object.assign(new Error('nope'), { name: 'AbortError' }));
        await replaceOriginal(written);
        await replaceOriginal(cancelled).catch(() => {});
        expect(alreadyHave(written)).toBe('saved');
        expect(alreadyHave(cancelled)).toBeNull();
    });

    it('reports a browser that cannot share files either', async () => {
        navigator.share = vi.fn();
        navigator.canShare = vi.fn().mockReturnValue(false);
        expect(replaceKind()).toBe(null);
        await expect(replaceOriginal({ elem: blob, fileName: 'a.jpg' }))
            .rejects.toThrow(/cannot choose a folder/);
    });
});
