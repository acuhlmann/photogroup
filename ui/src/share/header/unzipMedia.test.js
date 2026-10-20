import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';

// jsdom's Blob has no stream(), which browsers have and the unzip reads entries with.
if (!('stream' in Blob.prototype)) {
    Object.defineProperty(Blob.prototype, 'stream', {
        value() {
            const blob = this;
            return new ReadableStream({
                async start(controller) {
                    controller.enqueue(new Uint8Array(await blob.arrayBuffer()));
                    controller.close();
                },
            });
        },
    });
}

const { isZip, unpackZips, unzipMedia } = await import('./unzipMedia');
const { downloadZip } = await import('client-zip');
const { readLocation } = await import('../gallery/metadata/embed/mp4');
const { locationStripped } = await import('../gallery/metadata/strippedLocation');

const FIXTURES = join(__dirname, '../gallery/metadata/embed/__fixtures__');
const fixture = name => new Uint8Array(readFileSync(join(FIXTURES, name)));
const photosZip = () => new File([readFileSync(join(__dirname, '__fixtures__/photos.zip'))], 'photos.zip', { type: 'application/zip' });
const bytesOf = async blob => new Uint8Array(await blob.arrayBuffer());

/** A one-entry stored zip written with Zip64 records throughout, as tools do for archives over 4 GB. */
function zip64(name, data) {
    const nameBytes = new TextEncoder().encode(name);
    const parts = [];
    const add = (size, fill) => {
        const bytes = new Uint8Array(size);
        fill(new DataView(bytes.buffer));
        parts.push(bytes);
        return bytes;
    };
    const u64 = (view, at, value) => view.setBigUint64(at, BigInt(value), true);

    add(30, v => {
        v.setUint32(0, 0x04034b50, true); v.setUint16(4, 45, true);
        v.setUint32(18, 0xFFFFFFFF, true); v.setUint32(22, 0xFFFFFFFF, true);
        v.setUint16(26, nameBytes.length, true); v.setUint16(28, 20, true);
    });
    parts.push(nameBytes);
    add(20, v => { v.setUint16(0, 1, true); v.setUint16(2, 16, true); u64(v, 4, data.length); u64(v, 12, data.length); });
    parts.push(data);

    const directoryAt = parts.reduce((sum, part) => sum + part.length, 0);
    add(46, v => {
        v.setUint32(0, 0x02014b50, true); v.setUint16(4, 45, true); v.setUint16(6, 45, true);
        v.setUint32(20, 0xFFFFFFFF, true); v.setUint32(24, 0xFFFFFFFF, true);
        v.setUint16(28, nameBytes.length, true); v.setUint16(30, 28, true);
        v.setUint32(42, 0xFFFFFFFF, true);
    });
    parts.push(nameBytes);
    add(28, v => { v.setUint16(0, 1, true); v.setUint16(2, 24, true); u64(v, 4, data.length); u64(v, 12, data.length); u64(v, 20, 0); });
    const end64At = parts.reduce((sum, part) => sum + part.length, 0);
    const directorySize = end64At - directoryAt;

    add(56, v => {
        v.setUint32(0, 0x06064b50, true); u64(v, 4, 44); v.setUint16(12, 45, true); v.setUint16(14, 45, true);
        u64(v, 24, 1); u64(v, 32, 1); u64(v, 40, directorySize); u64(v, 48, directoryAt);
    });
    add(20, v => { v.setUint32(0, 0x07064b50, true); u64(v, 8, end64At); v.setUint32(16, 1, true); });
    add(22, v => {
        v.setUint32(0, 0x06054b50, true); v.setUint16(8, 0xFFFF, true); v.setUint16(10, 0xFFFF, true);
        v.setUint32(12, 0xFFFFFFFF, true); v.setUint32(16, 0xFFFFFFFF, true);
    });
    return new File(parts, 'big.zip');
}

describe('unzipMedia', () => {
    it('takes the photos and videos out of a zip, byte for byte, and leaves the rest', async () => {
        const files = await unzipMedia(photosZip());
        expect(files.map(file => [file.name, file.type])).toEqual([
            ['PXL_photo.jpg', 'image/jpeg'],
            ['PXL_gps.heic', 'image/heic'],
            ['PXL_clip.mp4', 'video/mp4'],
            ['Strand ü.jpg', 'image/jpeg'],
        ]);
        expect(await bytesOf(files[0])).toEqual(fixture('photo.jpg'));
        expect(await bytesOf(files[1])).toEqual(fixture('gps.heic'));
        expect(await bytesOf(files[2])).toEqual(fixture('android.mp4'));
        expect(new Date(files[0].lastModified)).toEqual(new Date(2026, 9, 12, 18, 30, 0));
    });

    it('keeps the location that Android would have blanked', async () => {
        const [, heic, clip, blanked] = await unzipMedia(photosZip());
        expect(await locationStripped(heic)).toBe(false);
        const location = await readLocation(clip);
        expect(location.lat).toBeCloseTo(31.2304, 4);
        expect(location.long).toBeCloseTo(121.4737, 4);
        // A photo that was blanked before it was zipped is still caught.
        expect(await locationStripped(blanked)).toBe(true);
    });

    it('reads Zip64 archives', async () => {
        const data = fixture('photo.jpg');
        const [file] = await unzipMedia(zip64('DCIM/Camera/big.jpg', data));
        expect(file.name).toBe('big.jpg');
        expect(await bytesOf(file)).toEqual(data);
    });
});

describe('unpackZips', () => {
    it('replaces zips with what is in them, keeping other files and making names unique', async () => {
        const loose = new File([fixture('photo.jpg')], 'PXL_photo.jpg', { type: 'image/jpeg' });
        const zip = new File([await downloadZip([
            { name: 'a/IMG_1.jpg', input: new Blob([fixture('photo.jpg')]) },
            { name: 'b/IMG_1.jpg', input: new Blob([fixture('blank-gps.jpg')]) },
        ]).blob()], 'more.zip');
        const { files, problems } = await unpackZips([loose, photosZip(), zip]);
        expect(problems).toEqual([]);
        expect(files[0]).toBe(loose);
        expect(files.map(file => file.name)).toEqual([
            'PXL_photo.jpg', 'PXL_photo (2).jpg', 'PXL_gps.heic', 'PXL_clip.mp4', 'Strand ü.jpg', 'IMG_1.jpg', 'IMG_1 (2).jpg',
        ]);
        expect(await bytesOf(files[6])).toEqual(fixture('blank-gps.jpg'));
    });

    it('says which zips it could not use', async () => {
        const empty = new File([await downloadZip([{ name: 'notes.txt', input: new Blob(['hi']) }]).blob()], 'notes.zip');
        const broken = new File([new Uint8Array([0x50, 0x4b, 3, 4, 1, 2, 3])], 'broken.zip');
        const cut = new File([(await bytesOf(photosZip())).slice(0, 2000)], 'cut.zip');
        const { files, problems } = await unpackZips([empty, broken, cut]);
        expect(files).toEqual([]);
        expect(problems).toEqual([
            'notes.zip has no photos or videos in it.',
            'Couldn’t open broken.zip: it isn’t a zip file.',
            'Couldn’t open cut.zip: it isn’t a zip file.',
        ]);
    });

    it('recognises zips by name or type', () => {
        expect(isZip(new File([], 'Photos.ZIP'))).toBe(true);
        expect(isZip(new File([], 'x', { type: 'application/zip' }))).toBe(true);
        expect(isZip(new File([], 'IMG_1.jpg', { type: 'image/jpeg' }))).toBe(false);
    });
});
