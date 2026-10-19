import { describe, it, expect, vi, beforeEach } from 'vitest';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import MetadataParser from './MetadataParser';
import { groupMetadataForDisplay } from './groupPhotoMetadata';

describe('MetadataParser media metadata', () => {
    beforeEach(() => {
        vi.restoreAllMocks();
    });

    it('reuses a single in-flight parse for the same item', async () => {
        const parseMediaMetadata = vi.fn()
            .mockResolvedValue({ format: { codec: 'h264' }, common: {} });

        const emitter = { emit: vi.fn() };
        const parser = new MetadataParser({ emitter });
        parser.parseMediaMetadata = parseMediaMetadata;

        const tile = {
            infoHash: 'abc',
            fileName: 'clip.mp4',
            isVideo: true,
        };

        const results = await Promise.all([
            new Promise(resolve => parser.readMetadata(tile, (t, md) => resolve(md))),
            new Promise(resolve => parser.readMetadata(tile, (t, md) => resolve(md))),
        ]);

        expect(parseMediaMetadata).toHaveBeenCalledTimes(1);
        expect(results[0].format.codec).toBe('h264');
        expect(results[1].format.codec).toBe('h264');
        expect(emitter.emit).toHaveBeenCalledTimes(1);
    });
});

describe('MetadataParser image catalog fields', () => {
    it('maps exifr XMP output to title, description, rating, label, keywords and creator', () => {
        const exifr = {
            Make: 'Canon',
            title: { lang: 'x-default', value: 'Sunset over Lake Zurich' },
            description: { lang: 'x-default', value: 'Golden hour.' },
            Rating: 4,
            Label: 'Green',
            subject: ['sunset', 'lake'],
            creator: 'Andreas',
        };
        const tile = { isImage: true, fileName: 'a.jpg', torrent: { name: 'a.jpg' } };
        const md = new MetadataParser({}).extractAndProcess(exifr, tile);

        expect(md['Title XMP']).toBe('Sunset over Lake Zurich');
        expect(md['x-Description']).toBe('Golden hour.');
        expect(md['Rating XMP']).toBe(4);
        expect(md['Label XMP']).toBe('Green');
        expect(md['Keywords XMP']).toBe('sunset, lake');
        expect(md['Creator XMP']).toBe('Andreas');
        // raw duplicates don't show up again as JSON rows
        expect(md.title).toBeUndefined();
        expect(md.subject).toBeUndefined();
    });

    it('decodes XML entities exifr leaves in XMP text', () => {
        const exifr = {
            title: { lang: 'x-default', value: 'Fish &amp; chips &lt;3' },
            description: { lang: 'x-default', value: 'Caf&#xE9; &#8212; pier' },
            subject: ['salt &amp; vinegar', 'sea'],
        };
        const tile = { isImage: true, fileName: 'a.jpg', torrent: { name: 'a.jpg' } };
        const md = new MetadataParser({}).extractAndProcess(exifr, tile);

        expect(md['Title XMP']).toBe('Fish & chips <3');
        expect(md['x-Description']).toBe('Café — pier');
        expect(md['Keywords XMP']).toBe('salt & vinegar, sea');
    });
});


describe('ExifParser GPS', () => {
    it('keeps southern and western coordinates negative', async () => {
        const { default: ExifParser } = await import('./ExifParser');
        const fromDms = { GPSLatitude: [33, 52, 4.2], GPSLatitudeRef: 'S', GPSLongitude: [151, 12, 26.4], GPSLongitudeRef: 'E' };
        ExifParser.parse(fromDms);
        expect(fromDms['x-Location'].lat).toBeCloseTo(-33.86783, 4);
        expect(fromDms['x-Location'].long).toBeCloseTo(151.20733, 4);

        const fromExifr = { GPSLatitude: [1, 2, 3], GPSLongitude: [1, 2, 3], latitude: 40.7, longitude: -74.0 };
        ExifParser.parse(fromExifr);
        expect(fromExifr['x-Location']).toEqual({ lat: 40.7, long: -74.0 });
    });

    it('drops a location it cannot convert instead of showing NaN', async () => {
        const { default: ExifParser } = await import('./ExifParser');
        const broken = { GPSLatitude: 'junk', GPSLongitude: [1, 2] };
        ExifParser.parse(broken);
        expect(broken['x-Location']).toBeUndefined();
    });
});

describe('MetadataParser reading where things were taken', () => {
    const fixture = name => new File([readFileSync(fileURLToPath(new URL('./embed/__fixtures__/' + name, import.meta.url)))], name);

    it('reads Exif GPS from a HEIC, which exifr cannot parse on its own', async () => {
        const output = await MetadataParser.parseImage(fixture('gps.heic'));
        expect(output.Make).toBe('Apple');
        const tile = { isImage: true, fileName: 'gps.heic' };
        const md = new MetadataParser({}).extractAndProcess(output, tile);
        expect(md['x-Location'].lat).toBeCloseTo(-33.86783, 4);
        expect(md['x-Location'].long).toBeCloseTo(151.20733, 4);
        expect(md['x-Location'].altitude).toBe(58);
    });

    it('says the location was removed when GPS fields are blank, instead of showing NaN rows', async () => {
        // Android zeroes a photo's GPS fields when a browser picks it without location access.
        const tile = { isImage: true, fileName: 'blank-gps.jpg' };
        const parser = new MetadataParser({});
        const md = parser.extractAndProcess(await MetadataParser.parseImage(fixture('blank-gps.jpg')), tile);
        const summary = parser.createMetadataSummary(md, tile);
        const grouped = groupMetadataForDisplay(summary, tile);

        expect(grouped.location).toBeNull();
        expect(grouped.locationBlank).toBe(true);
        expect(summary.filter(item => /^GPS|^latitude|^longitude/.test(item.key))).toEqual([]);
        expect(summary.some(item => /NaN/.test(String(item.value)))).toBe(false);
        expect(grouped.missing).not.toContain('Location');
        expect(grouped.lead.map(item => item.key)).toContain('x-Camera');
    });

    it('hides raw values nobody can read', () => {
        const tile = { isImage: true, fileName: 'a.jpg' };
        const summary = new MetadataParser({}).createMetadataSummary({
            Blank: new Uint8Array(15),
            Text: new Uint8Array([65, 83, 67, 73, 73, 0, 0]),
            Fractions: [NaN, NaN, NaN],
            Clock: 'NaN:NaN:NaN',
            Count: NaN,
            Version: [2, 3, 0, 0],
            Note: 'NaNa beach',
        }, tile);
        expect(Object.fromEntries(summary.map(item => [item.key, item.value])))
            .toEqual({ Text: 'ASCII', Version: '2,3,0,0', Note: 'NaNa beach' });
    });

    it('reads XMP from a HEIC', async () => {
        const output = await MetadataParser.parseImage(fixture('photo.heic'));
        const md = new MetadataParser({}).extractAndProcess(output, { isImage: true, fileName: 'photo.heic' });
        expect(md['Title XMP']).toBe('Old');
    });

    const near = (location, lat, long) => {
        expect(location.lat).toBeCloseTo(lat, 4);
        expect(location.long).toBeCloseTo(long, 4);
    };

    it('reads the 3GPP location ffmpeg writes into an MP4', async () => {
        near(await MetadataParser.readVideoLocation({ file: fixture('android.mp4') }), 31.2304, 121.4737);
    });

    it('reads the QuickTime location Android phones write', async () => {
        expect(await MetadataParser.readVideoLocation({ file: fixture('phone.mov') }))
            .toEqual({ lat: -33.8678, long: 151.2073 });
    });

    it("reads the location an iPhone writes into Apple's keyed metadata", async () => {
        expect(await MetadataParser.readVideoLocation({ elem: fixture('iphone.mov') }))
            .toEqual({ lat: 47.3769, long: 8.5417, altitude: 408 });
    });

    it('reads a video location from a torrent file still arriving', async () => {
        const bytes = new Uint8Array(await fixture('android.mp4').arrayBuffer());
        const torrentFile = {
            length: bytes.length,
            createReadStream: ({ start, end }) => {
                const handlers = {};
                const stream = { on: (event, handler) => { handlers[event] = handler; return stream; } };
                setTimeout(() => {
                    handlers.data(bytes.subarray(start, end + 1));
                    handlers.end();
                }, 0);
                return stream;
            },
        };
        near(await MetadataParser.readVideoLocation({ torrentFile }), 31.2304, 121.4737);
        expect(await MetadataParser.readVideoLocation({ file: fixture('faststart.mp4') })).toBeNull();
    });
});

