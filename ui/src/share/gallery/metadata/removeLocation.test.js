import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { embedDetails } from './embed/embedDetails';
import { readMetadataItems } from './embed/heif';
import { hasLocation, withoutLocation } from './removeLocation';
import MetadataParser from './MetadataParser';

async function shownLocation(file) {
    const parser = new MetadataParser({});
    const data = await parser.extractAndProcess(await MetadataParser.parseImage(file), { isImage: true, fileName: file.name });
    return data['x-Location'];
}

const BUND = { lat: 31.24, long: 121.4905 };

function fixture(name, type = '') {
    const bytes = readFileSync(fileURLToPath(new URL('./embed/__fixtures__/' + name, import.meta.url)));
    return new File([bytes], name, { type, lastModified: 1700000000000 });
}

const asFile = (blob, name, type) => new File([blob], name, { type, lastModified: 1700000000000 });

describe('withoutLocation', () => {
    it('takes the GPS position out of a JPEG and keeps the name, type and date', async () => {
        const placed = asFile(await embedDetails(fixture('blank-gps.jpg'), { location: BUND }), 'a.jpg', 'image/jpeg');
        expect(await hasLocation(placed)).toBe(true);
        const clean = await withoutLocation(placed);
        expect(await hasLocation(clean)).toBe(false);
        expect(await shownLocation(placed)).toBeTruthy();
        expect(await shownLocation(clean)).toBeFalsy();
        expect([clean.name, clean.type, clean.lastModified]).toEqual(['a.jpg', 'image/jpeg', 1700000000000]);
    });

    it('blanks the EXIF GPS of a HEIC from a phone', async () => {
        const photo = fixture('gps.heic', 'image/heic');
        expect(await hasLocation(photo)).toBe(true);
        const clean = await withoutLocation(photo);
        expect(await hasLocation(clean)).toBe(false);
        const { exif } = await readMetadataItems(clean);
        expect(exif).toBeTruthy();
        expect(await shownLocation(photo)).toBeTruthy();
        expect(await shownLocation(clean)).toBeFalsy();
    });

    it('removes the location of iPhone and Android clips', async () => {
        for (const name of ['iphone.mov', 'iphone-top.mov', 'phone.mov']) {
            const clip = fixture(name, 'video/quicktime');
            const tagged = (await hasLocation(clip)) ? clip : asFile(await embedDetails(clip, { location: BUND }), name, 'video/quicktime');
            expect(await hasLocation(tagged)).toBe(true);
            expect(await hasLocation(await withoutLocation(tagged))).toBe(false);
        }
    });

    it('leaves a file without a location as it is', async () => {
        for (const name of ['photo.png', 'song.mp3', 'photo.jpg']) {
            const file = fixture(name);
            if (await hasLocation(file)) continue;
            expect(await withoutLocation(file)).toBe(file);
        }
    });
});
