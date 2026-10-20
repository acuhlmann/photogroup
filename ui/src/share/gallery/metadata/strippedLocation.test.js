import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { locationStripped, partitionStripped } from './strippedLocation';
import { embedDetails } from './embed/embedDetails';
import { patchGps } from './embed/exifGps';
import { readUint } from './embed/binary';

function fixtureBytes(name) {
    return new Uint8Array(readFileSync(fileURLToPath(new URL('./embed/__fixtures__/' + name, import.meta.url))));
}

const file = (bytes, name) => new File([bytes], name);

function indexOf(bytes, pattern) {
    for (let i = 0; i + pattern.length <= bytes.length; i++) {
        if (pattern.every((byte, j) => bytes[i + j] === byte)) return i;
    }
    return -1;
}

/** Zero GPS latitude/longitude in the file's EXIF the way Android does: values only, layout kept. */
function blankExif(bytes) {
    const at = Math.max(indexOf(bytes, [0x4D, 0x4D, 0x00, 0x2A]), indexOf(bytes, [0x49, 0x49, 0x2A, 0x00]));
    const copy = bytes.slice();
    copy.set(patchGps(copy.subarray(at), null), at);
    return copy;
}

/** Zero a video box's type and contents the way Android does, keeping its size. */
function blankBox(bytes, type) {
    const at = indexOf(bytes, Array.from(type, char => char.charCodeAt(0)));
    const size = readUint(bytes, at - 4, 4);
    const copy = bytes.slice();
    copy.fill(0, at, at - 4 + size);
    return copy;
}

describe('locationStripped', () => {
    it('flags a JPEG whose GPS Android zeroed', async () => {
        expect(await locationStripped(file(fixtureBytes('blank-gps.jpg'), 'a.jpg'))).toBe(true);
    });

    it('leaves photos with a real position, or none, alone', async () => {
        const blank = new Blob([fixtureBytes('blank-gps.jpg')]);
        const placed = await embedDetails(blank, { location: { lat: 31.24, long: 121.4905 } });
        const nullIsland = await embedDetails(blank, { location: { lat: 0, long: 0 } });
        expect(await locationStripped(file(placed, 'a.jpg'))).toBe(false);
        expect(await locationStripped(file(nullIsland, 'b.jpg'))).toBe(false);
        expect(await locationStripped(file(fixtureBytes('photo.jpg'), 'c.jpg'))).toBe(false);
    });

    it('flags a HEIC whose Exif GPS was zeroed', async () => {
        const original = fixtureBytes('gps.heic');
        expect(await locationStripped(file(original, 'a.heic'))).toBe(false);
        expect(await locationStripped(file(blankExif(original), 'a.heic'))).toBe(true);
        expect(await locationStripped(file(fixtureBytes('photo.heic'), 'b.heic'))).toBe(false);
    });

    it('flags videos whose location box was wiped', async () => {
        const mov = fixtureBytes('phone.mov');
        const mp4 = fixtureBytes('android.mp4');
        expect(await locationStripped(file(mov, 'a.mov'))).toBe(false);
        expect(await locationStripped(file(mp4, 'a.mp4'))).toBe(false);
        expect(await locationStripped(file(blankBox(mov, '©xyz'), 'a.mov'))).toBe(true);
        expect(await locationStripped(file(blankBox(mp4, 'loci'), 'a.mp4'))).toBe(true);
        expect(await locationStripped(file(fixtureBytes('faststart.mp4'), 'b.mp4'))).toBe(false);
    });

    it('treats files it cannot read as fine', async () => {
        expect(await locationStripped(file(new Uint8Array([0xFF, 0xD8, 0xFF, 0xE1, 0x00]), 'cut.jpg'))).toBe(false);
        expect(await locationStripped(file(new TextEncoder().encode('hello'), 'notes.txt'))).toBe(false);
        expect(await locationStripped(file(fixtureBytes('song.mp3'), 'song.mp3'))).toBe(false);
    });

    it('splits a pick into intact and stripped files', async () => {
        const good = file(fixtureBytes('photo.jpg'), 'good.jpg');
        const bad = file(fixtureBytes('blank-gps.jpg'), 'bad.jpg');
        const { intact, stripped } = await partitionStripped([good, bad]);
        expect(intact).toEqual([good]);
        expect(stripped).toEqual([bad]);
    });
});
