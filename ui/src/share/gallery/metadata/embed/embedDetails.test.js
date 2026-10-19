import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import * as mm from 'music-metadata';
import { embedDetails } from './embedDetails';
import { parseBoxes } from './isobmff';
import { parseItemInfo, parseLocations } from './heif';
import { readUint } from './binary';
import { readLocation } from './mp4';
import MetadataParser from '../MetadataParser';

const DETAILS = { title: 'Fish & "chips" ü', description: 'At the pier', rating: 4 };

function fixture(name) {
    return new Blob([readFileSync(fileURLToPath(new URL('./__fixtures__/' + name, import.meta.url)))]);
}

async function bytesOf(blob) {
    return new Uint8Array(await blob.arrayBuffer());
}

/** Title, description, rating and keywords from an XMP packet, across all its rdf:Description blocks. */
function readXmp(xml) {
    const doc = new DOMParser().parseFromString(xml, 'application/xml');
    const DC = 'http://purl.org/dc/elements/1.1/';
    const XMP = 'http://ns.adobe.com/xap/1.0/';
    const items = name => Array.from(doc.getElementsByTagNameNS(DC, name))
        .flatMap(node => Array.from(node.getElementsByTagNameNS('*', 'li')).map(li => li.textContent));
    const rating = Array.from(doc.getElementsByTagNameNS('*', 'Description'))
        .map(node => node.getAttributeNS(XMP, 'Rating') || node.getElementsByTagNameNS(XMP, 'Rating')[0]?.textContent)
        .find(Boolean);
    return {
        titles: items('title'),
        descriptions: items('description'),
        rating: rating ? Number(rating) : undefined,
        keywords: items('subject'),
    };
}

/** Every XMP packet in the file. */
async function xmpPackets(blob) {
    const text = new TextDecoder().decode(await bytesOf(blob));
    return [...text.matchAll(/<x:xmpmeta[\s\S]*?<\/x:xmpmeta>/g)].map(match => readXmp(match[0]));
}

async function media(blob) {
    const metadata = await mm.parseBuffer(await bytesOf(blob));
    const rating = metadata.common.rating?.[0]?.rating;
    return {
        title: metadata.common.title,
        description: metadata.common.description?.[0] ?? metadata.common.description
            ?? metadata.common.comment?.find(comment => !comment.descriptor)?.text,
        comments: (metadata.common.comment || []).map(comment => comment.text),
        artist: metadata.common.artist,
        stars: rating == null ? null : mm.ratingToStars(rating),
    };
}

/** Each HEIF item's bytes, keyed by item id. */
async function heifItems(blob) {
    const bytes = await bytesOf(blob);
    const meta = parseBoxes(bytes).find(item => item.type === 'meta');
    const kids = parseBoxes(bytes, meta.start + meta.header + 4, meta.end);
    const infos = parseItemInfo(bytes, kids.find(kid => kid.type === 'iinf'));
    const table = parseLocations(bytes, kids.find(kid => kid.type === 'iloc'));
    return Object.fromEntries(table.items.filter(item => item.method === 0).map(item => [item.id, {
        type: infos.find(info => info.id === item.id)?.type,
        data: item.extents.map(extent => Array.from(bytes.subarray(item.base + extent.offset,
            item.base + extent.offset + extent.length))).flat(),
    }]));
}

/** The first bytes of every chunk an MP4's sample tables point at. */
function chunkStarts(bytes) {
    const starts = [];
    const walk = (start, end, path) => parseBoxes(bytes, start, end).forEach(item => {
        if (path.length && item.type === path[0]) walk(item.start + item.header, item.end, path.slice(1));
        if (!path.length && (item.type === 'stco' || item.type === 'co64')) {
            const size = item.type === 'stco' ? 4 : 8;
            const at = item.start + item.header + 8;
            for (let i = 0; i < readUint(bytes, at - 4, 4); i++) {
                const offset = readUint(bytes, at + i * size, size);
                starts.push(Array.from(bytes.subarray(offset, offset + 16)).join());
            }
        }
    });
    walk(0, bytes.length, ['moov', 'trak', 'mdia', 'minf', 'stbl']);
    return starts;
}

describe('embedDetails', () => {
    it('returns the original file when nobody edited its details', async () => {
        const blob = fixture('photo.jpg');
        expect(await embedDetails(blob, undefined)).toBe(blob);
        expect(await embedDetails(blob, { editedBy: 'peer', editedAt: 1 })).toBe(blob);
    });

    it('leaves formats it does not know untouched', async () => {
        const blob = new Blob([new TextEncoder().encode('GIF89a not really')], { type: 'image/gif' });
        expect(await embedDetails(blob, DETAILS)).toBe(blob);
    });

    describe.each([
        ['photo.jpg', 'image/jpeg'],
        ['photo.png', 'image/png'],
        ['lossy.webp', 'image/webp'],
        ['alpha.webp', 'image/webp'],
    ])('%s', (name) => {
        it('replaces the edited fields in a single XMP packet and keeps the rest', async () => {
            const result = await embedDetails(fixture(name), DETAILS);
            const packets = await xmpPackets(result);
            expect(packets).toHaveLength(1);
            expect(packets[0]).toMatchObject({
                titles: [DETAILS.title], descriptions: [DETAILS.description], rating: 4,
                keywords: name.endsWith('.webp') ? [] : ['beach'],
            });
        });
    });

    it('removes cleared fields from XMP instead of writing them empty', async () => {
        const result = await embedDetails(fixture('photo.jpg'), { title: '', rating: 0 });
        const [packet] = await xmpPackets(result);
        expect(packet).toMatchObject({ titles: [], rating: undefined, descriptions: ['Old text'], keywords: ['beach'] });
    });

    it('upgrades a simple WebP to the extended layout that can hold XMP', async () => {
        for (const name of ['lossy.webp', 'alpha.webp']) {
            const bytes = await bytesOf(await embedDetails(fixture(name), DETAILS));
            const text = new TextDecoder('latin1').decode(bytes);
            expect(text.slice(12, 16)).toBe('VP8X');
            expect(bytes[20] & 0x04).toBe(0x04);
            expect(readUint(bytes.slice(4, 8).reverse(), 0, 4)).toBe(bytes.length - 8);
            // canvas size matches the 16x12 image
            expect(bytes[24] | (bytes[25] << 8)).toBe(15);
            expect(bytes[27] | (bytes[28] << 8)).toBe(11);
        }
    });

    describe.each(['photo.heic', 'photo.avif'])('%s', (name) => {
        it('stores the details as an XMP item and keeps every image item intact', async () => {
            const original = fixture(name);
            const result = await embedDetails(original, DETAILS);
            const before = await heifItems(original);
            const after = await heifItems(result);

            const xmpItems = Object.values(after).filter(item => item.type === 'mime');
            expect(xmpItems).toHaveLength(1);
            const xml = new TextDecoder().decode(new Uint8Array(xmpItems[0].data));
            expect(readXmp(xml)).toMatchObject({
                titles: [DETAILS.title], descriptions: [DETAILS.description], rating: 4,
                keywords: name === 'photo.heic' ? ['beach'] : [],
            });

            Object.entries(before).filter(([, item]) => item.type !== 'mime').forEach(([id, item]) => {
                expect(after[id].data).toEqual(item.data);
            });
        });
    });

    it('tags an MP4 and keeps its chunk offsets pointing at the same media', async () => {
        const original = fixture('faststart.mp4');
        const result = await embedDetails(original, DETAILS);
        expect(await media(result)).toMatchObject({
            title: DETAILS.title, description: DETAILS.description, stars: 4, comments: ['keepme'],
        });
        expect(chunkStarts(await bytesOf(result))).toEqual(chunkStarts(await bytesOf(original)));
    });

    it('tags a QuickTime movie', async () => {
        expect(await media(await embedDetails(fixture('clip.mov'), DETAILS)))
            .toMatchObject({ title: DETAILS.title, description: DETAILS.description, stars: 4 });
    });

    it('rewrites the ID3 tag of an MP3 and keeps its other frames', async () => {
        const result = await embedDetails(fixture('song.mp3'), DETAILS);
        expect(await media(result)).toMatchObject({
            title: DETAILS.title, comments: [DETAILS.description], artist: 'Band', stars: 4,
        });
    });

    it('adds an ID3 tag to an MP3 without one', async () => {
        const bytes = await bytesOf(fixture('song.mp3'));
        const tagSize = (bytes[6] << 21) | (bytes[7] << 14) | (bytes[8] << 7) | bytes[9];
        const bare = new Blob([bytes.subarray(10 + tagSize)]);
        expect(await media(await embedDetails(bare, DETAILS)))
            .toMatchObject({ title: DETAILS.title, comments: [DETAILS.description], stars: 4 });
    });

    it('keeps an MP3 as it is when a frame size overruns the tag', async () => {
        const bytes = await bytesOf(fixture('song.mp3'));
        // Inflate the first frame's size past the end of the tag.
        bytes.set([0x7F, 0xFF, 0xFF, 0xFF], 14);
        const broken = new Blob([bytes]);
        expect(await embedDetails(broken, DETAILS)).toBe(broken);
    });

    it('replaces PNG XMP that comes after the image data instead of adding a second packet', async () => {
        const bytes = await bytesOf(fixture('photo.png'));
        const chunks = [];
        for (let offset = 8; offset < bytes.length;) {
            const end = offset + 12 + readUint(bytes, offset, 4);
            chunks.push({ type: new TextDecoder('latin1').decode(bytes.subarray(offset + 4, offset + 8)), bytes: bytes.subarray(offset, end) });
            offset = end;
        }
        const xmp = chunks.find(item => item.type === 'iTXt');
        const others = chunks.filter(item => item !== xmp);
        const iend = others.pop();
        const moved = new Blob([bytes.subarray(0, 8), ...others.map(item => item.bytes), xmp.bytes, iend.bytes]);

        const packets = await xmpPackets(await embedDetails(moved, DETAILS));
        expect(packets).toHaveLength(1);
        expect(packets[0]).toMatchObject({ titles: [DETAILS.title], keywords: ['beach'] });
    });

    it('writes FLAC Vorbis comments and keeps the others', async () => {
        const result = await embedDetails(fixture('song.flac'), DETAILS);
        expect(await media(result)).toMatchObject({
            title: DETAILS.title, comments: [DETAILS.description], artist: 'Band', stars: 4,
        });
    });

    it('drops cleared and rejected fields from audio tags', async () => {
        const result = await embedDetails(fixture('song.mp3'), { title: '', description: '', rating: -1 });
        expect(await media(result)).toMatchObject({ title: undefined, comments: [], artist: 'Band', stars: null });
    });

    describe('location', () => {
        const BUND = { lat: 31.2400, long: 121.4905, name: 'The Bund' };
        const readImage = async (blob, name) => {
            const tile = { isImage: true, fileName: name };
            const parser = new MetadataParser({});
            return parser.extractAndProcess(await MetadataParser.parseImage(new File([blob], name)), tile);
        };

        it('fills in the EXIF GPS a phone blanked, as well as XMP', async () => {
            const result = await embedDetails(fixture('blank-gps.jpg'), { location: BUND });
            const location = (await readImage(result, 'a.jpg'))['x-Location'];
            expect(location.lat).toBeCloseTo(31.24, 4);
            expect(location.long).toBeCloseTo(121.4905, 4);
            const [packet] = await xmpPackets(result);
            expect(packet).toBeTruthy();
            expect(new TextDecoder().decode(await bytesOf(result))).toContain('exif:GPSLatitude="31,14.4N"');
        });

        it('writes the location into XMP where there is no EXIF GPS', async () => {
            for (const name of ['photo.jpg', 'photo.png']) {
                const location = (await readImage(await embedDetails(fixture(name), { location: { lat: -33.8678, long: 151.2073 } }), name))['x-Location'];
                expect(location.lat).toBeCloseTo(-33.8678, 4);
                expect(location.long).toBeCloseTo(151.2073, 4);
            }
        });

        it('hides a location in EXIF and XMP when it is removed', async () => {
            const placed = await embedDetails(fixture('blank-gps.jpg'), { location: BUND });
            const removed = await embedDetails(placed, { location: null });
            const md = await readImage(removed, 'a.jpg');
            expect(md['x-Location']).toBeUndefined();
            expect(new TextDecoder().decode(await bytesOf(removed))).not.toContain('GPSLatitude=');
        });

        it('stores the location as an XMP item in a HEIC', async () => {
            const { xmp } = await (await import('./heif')).readMetadataItems(await embedDetails(fixture('photo.heic'), { location: BUND }));
            expect(xmp).toContain('exif:GPSLatitude="31,14.4N"');
            expect(xmp).toContain('exif:GPSLongitude="121,29.43E"');
        });

        it('replaces a video\'s own location', async () => {
            const tagged = await embedDetails(fixture('phone.mov'), { location: BUND });
            const location = await readLocation(tagged);
            expect(location).toEqual({ lat: 31.24, long: 121.4905 });
            expect(await readLocation(await embedDetails(fixture('phone.mov'), { location: null }))).toBeNull();

            const original = fixture('faststart.mp4');
            const moved = await embedDetails(original, { location: BUND });
            expect(await readLocation(moved)).toEqual({ lat: 31.24, long: 121.4905 });
            expect(chunkStarts(await bytesOf(moved))).toEqual(chunkStarts(await bytesOf(original)));
        });
    });
});
