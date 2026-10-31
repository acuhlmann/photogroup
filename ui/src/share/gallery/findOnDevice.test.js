import { describe, it, expect, vi, beforeEach } from 'vitest';
import { canFindOnDevice, findOnDevice, pickFolder } from './findOnDevice';
import { alreadyHave, clearHave } from './alreadyHave';
import { fingerprintFile } from './fingerprint';
import { embedDetails } from './metadata/embed/embedDetails';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';

const file = (text, name) => new File([text], name);

/** A folder handle as showDirectoryPicker returns, from { name: File | folder }. */
function folder(name, children) {
    return {
        kind: 'directory',
        name,
        async *values() {
            for (const [childName, child] of Object.entries(children)) {
                yield child instanceof File
                    ? { kind: 'file', name: childName, getFile: async () => child }
                    : folder(childName, child);
            }
        },
    };
}

describe('findOnDevice', () => {
    beforeEach(() => clearHave());

    it('finds a copy saved with the room details, by the original it notes', async () => {
        const original = new File([readFileSync(join(__dirname, 'metadata/embed/__fixtures__/photo.jpg'))], 'photo.jpg');
        const fingerprint = await fingerprintFile(original);
        const saved = await embedDetails(original, { title: 'Dock' }, { originalFingerprint: fingerprint });
        const tiles = [{ fileName: 'photo.jpg', fingerprint }];

        // Another browser's download folder: renamed by the browser, or under another name.
        expect(await findOnDevice(tiles, [new File([saved], 'other.jpg')])).toEqual([]);
        expect(await findOnDevice(tiles, [new File([saved], 'PHOTO (1).jpg')])).toEqual(tiles);
        expect(alreadyHave(tiles[0])).toBe('device');
    });

    it('finds room photos among the files, whatever they are called, and remembers them', async () => {
        const mine = file('beach photo bytes', 'IMG_0001.JPG');
        const theirs = file('someone else', 'PXL_2.jpg');
        const tiles = [
            { fileName: 'beach.jpg', fingerprint: await fingerprintFile(mine) },
            { fileName: 'other.jpg', fingerprint: await fingerprintFile(theirs) },
            { fileName: 'old.jpg' },
        ];
        const onProgress = vi.fn();
        const found = await findOnDevice(tiles, [file('unrelated', 'x.jpg'), mine], { onProgress });
        expect(found).toEqual([tiles[0]]);
        expect(alreadyHave(tiles[0])).toBe('device');
        expect(alreadyHave(tiles[1])).toBeNull();
        expect(onProgress).toHaveBeenLastCalledWith(2, 2);
    });

    it('only reads files whose size matches a room photo', async () => {
        const photo = file('12345', 'a.jpg');
        const sameSize = file('54321', 'b.jpg');
        const otherSize = file('much longer content', 'c.jpg');
        const spies = [photo, sameSize, otherSize].map(item => vi.spyOn(item, 'slice'));
        const tiles = [{ fingerprint: await fingerprintFile(file('12345', 'room.jpg')) }];
        const found = await findOnDevice(tiles, [sameSize, otherSize, photo]);
        expect(found).toEqual(tiles);
        expect(spies[2]).not.toHaveBeenCalled();
    });

    it('reads file handles and skips ones it cannot open', async () => {
        const photo = file('handle bytes', 'a.jpg');
        const tiles = [{ fingerprint: await fingerprintFile(photo) }];
        const broken = { kind: 'file', name: 'gone.jpg', getFile: () => Promise.reject(new Error('gone')) };
        const found = await findOnDevice(tiles, [broken, { kind: 'file', name: 'a.jpg', getFile: async () => photo }]);
        expect(found).toEqual(tiles);
    });

    it('says whether anything here can be looked for', () => {
        expect(canFindOnDevice([{ fileName: 'old.jpg' }])).toBe(false);
        expect(canFindOnDevice([{ fingerprint: '3:' + '0'.repeat(64) }])).toBe(true);
    });
});

describe('pickFolder', () => {
    it('lists a picked folder and its subfolders, skipping hidden ones', async () => {
        const a = file('a', 'a.jpg');
        const b = file('b', 'b.jpg');
        const win = {
            showDirectoryPicker: vi.fn().mockResolvedValue(folder('DCIM', {
                'a.jpg': a,
                Camera: { 'b.jpg': b },
                '.thumbnails': { 'c.jpg': file('c', 'c.jpg') },
                '.nomedia': file('', '.nomedia'),
            })),
        };
        const entries = await pickFolder(win);
        expect(entries.map(entry => entry.name)).toEqual(['a.jpg', 'b.jpg']);
        expect(await entries[1].getFile()).toBe(b);
    });

    it('returns nothing when the picker is closed', async () => {
        const win = { showDirectoryPicker: vi.fn().mockRejectedValue(Object.assign(new Error('closed'), { name: 'AbortError' })) };
        expect(await pickFolder(win)).toEqual([]);
    });

    it('falls back to a folder input where there is no folder picker', async () => {
        const picked = [file('a', 'a.jpg')];
        const click = vi.spyOn(HTMLInputElement.prototype, 'click').mockImplementation(function () {
            Object.defineProperty(this, 'files', { value: picked });
            this.dispatchEvent(new Event('change'));
        });
        expect(await pickFolder({ document })).toEqual(picked);
        expect(document.querySelector('input[type="file"]')).toBeNull();
        click.mockRestore();
    });
});
