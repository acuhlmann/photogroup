import { describe, it, expect, vi } from 'vitest';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import Logger from 'js-logger';
import { describePicked, missingLocation, partitionIPhonePick, pickedLine } from './iphonePick';

function fixtureBytes(name) {
    return new Uint8Array(readFileSync(fileURLToPath(new URL('./embed/__fixtures__/' + name, import.meta.url))));
}

/** A tiny JPEG whose EXIF says only who made it: an iPhone photo after Safari removed the location. */
const iphoneJpeg = () => fixtureBytes('iphone-no-gps.jpg');

/** The same JPEG with another camera's make. */
function otherCameraJpeg() {
    const bytes = iphoneJpeg().slice();
    const at = Buffer.from(bytes).indexOf('Apple');
    bytes.set(Array.from('Canon', char => char.charCodeAt(0)), at);
    return bytes;
}

/** The iPhone clip with its location key renamed, so it reads as a clip without a location. */
function clipWithoutLocation() {
    const bytes = fixtureBytes('iphone.mov').slice();
    const key = 'com.apple.quicktime.location.ISO6709';
    const at = Buffer.from(bytes).indexOf(key);
    bytes.set(Array.from('com.apple.quicktime.location.XXXXXXX', char => char.charCodeAt(0)), at);
    return bytes;
}

const file = (bytes, name) => new File([bytes], name);

describe('describePicked', () => {
    it('reads format, camera and location of an iPhone HEIC', async () => {
        const facts = await describePicked(file(fixtureBytes('gps.heic'), 'IMG_1.HEIC'));
        expect(facts).toMatchObject({ format: 'HEIC', make: 'Apple', location: true });
        expect(facts.model).toMatch(/^iPhone/);
        expect(missingLocation(facts)).toBe(false);
    });

    it('sees an iPhone JPEG without a location', async () => {
        const facts = await describePicked(file(iphoneJpeg(), 'IMG_2.JPG'));
        expect(facts).toMatchObject({ format: 'JPEG', make: 'Apple', model: 'iPhone 15', location: false });
        expect(missingLocation(facts)).toBe(true);
    });

    it('reads camera, codec and location of an iPhone clip', async () => {
        const facts = await describePicked(file(fixtureBytes('iphone.mov'), 'IMG_3.MOV'));
        expect(facts).toMatchObject({ format: 'MOV', make: 'Apple', codec: 'H.264', location: true });
        const without = await describePicked(file(clipWithoutLocation(), 'IMG_4.MOV'));
        expect(without).toMatchObject({ make: 'Apple', location: false });
        expect(missingLocation(without)).toBe(true);
    });

    it('does not flag photos from other cameras or without camera details', async () => {
        const other = await describePicked(file(otherCameraJpeg(), 'a.jpg'));
        expect(other).toMatchObject({ make: 'Canon', location: false });
        expect(missingLocation(other)).toBe(false);
        for (const name of ['photo.jpg', 'photo.png', 'phone.mov']) {
            expect(missingLocation(await describePicked(file(fixtureBytes(name), name)))).toBe(false);
        }
    });

    it('gives nulls for a file it cannot read', async () => {
        expect(await describePicked(file(new Uint8Array([1, 2, 3]), 'x.bin')))
            .toEqual({ format: null, make: null, model: null, codec: null, location: null });
    });
});

describe('pickedLine', () => {
    it('says what arrived, for comparing with the Photos app', () => {
        const line = pickedLine({ name: 'IMG_1.HEIC', size: 2134567, type: '' },
            { format: 'HEIC', make: 'Apple', model: 'iPhone 15', codec: null, location: true });
        expect(line).toBe('Picked IMG_1.HEIC: HEIC, 2.1 MB (2134567 bytes), Apple iPhone 15, location: yes');
    });

    it('notes a file whose name and format differ, and a clip codec', () => {
        expect(pickedLine({ name: 'IMG_1.HEIC', size: 1000, type: 'image/jpeg' },
            { format: 'JPEG', make: null, model: null, codec: null, location: null }))
            .toBe('Picked IMG_1.HEIC: JPEG, 0.0 MB (1000 bytes), no camera details, location: unknown, the name says HEIC, but it is JPEG');
        expect(pickedLine({ name: 'IMG_2.MOV', size: 1000, type: '' },
            { format: 'MOV', make: 'Apple', model: 'iPhone 15', codec: 'HEVC', location: false }))
            .toBe('Picked IMG_2.MOV: MOV, 0.0 MB (1000 bytes), Apple iPhone 15, video HEVC, location: no');
    });
});

describe('partitionIPhonePick', () => {
    it('holds back iPhone files without a location, shares the rest, and logs each', async () => {
        const info = vi.spyOn(Logger, 'info').mockImplementation(() => {});
        const placed = file(fixtureBytes('gps.heic'), 'IMG_1.HEIC');
        const bare = file(iphoneJpeg(), 'IMG_2.JPG');
        const other = file(fixtureBytes('photo.png'), 'screen.png');

        const { intact, held } = await partitionIPhonePick([placed, bare, other]);

        expect(intact).toEqual([placed, other]);
        expect(held).toEqual([bare]);
        expect(info.mock.calls.map(call => call[0])).toEqual([
            expect.stringMatching(/^Picked IMG_1\.HEIC: HEIC, .* location: yes$/),
            expect.stringMatching(/^Picked IMG_2\.JPG: JPEG, .*Apple iPhone 15, location: no$/),
            expect.stringMatching(/^Picked screen\.png: PNG, .*no camera details, location: unknown$/),
        ]);
        info.mockRestore();
    });
});
