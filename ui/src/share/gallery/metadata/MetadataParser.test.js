import { describe, it, expect, vi, beforeEach } from 'vitest';
import MetadataParser from './MetadataParser';

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
});

