import { describe, it, expect } from 'vitest';
import {
    flattenMetadataSummary,
    groupMetadataForDisplay,
    groupPhotoMetadata,
    humanizeMetadataValue,
} from './groupPhotoMetadata';

describe('groupPhotoMetadata', () => {
    it('puts XMP title, description, and rating in highlights', () => {
        const summary = [
            { key: 'Make', value: 'Canon' },
            { key: 'Title XMP', value: 'Sunset pier' },
            { key: 'x-Description', value: 'Golden hour at the harbor.' },
            { key: 'Rating XMP', value: 4 },
            { key: 'DateTimeOriginal', value: 'Oct 15 2026' },
        ];
        const tile = { isImage: true };
        const { highlights, lead, more } = groupMetadataForDisplay(summary, tile);

        expect(highlights.map(h => h.kind)).toEqual(['title', 'rating', 'description']);
        expect(highlights[0].value).toBe('Sunset pier');
        expect(lead.some(item => item.key === 'DateTimeOriginal')).toBe(true);
        expect(lead.some(item => item.key === 'Title XMP')).toBe(false);
        expect(more.some(item => item.key === 'Make')).toBe(true);
    });

    it('flattens video common and format metadata', () => {
        const summary = [
            {
                key: 'common',
                value: {
                    title: 'Clip title',
                    artist: 'Director',
                    starRating: 3,
                },
            },
            {
                key: 'format',
                value: {
                    duration: '2 min',
                    codec: 'h264',
                    container: 'MP4',
                    bitrate: 1200000,
                },
            },
        ];
        const tile = { isVideo: true };
        const flat = flattenMetadataSummary(summary, tile);
        expect(flat.find(item => item.key === 'media.title')?.value).toBe('Clip title');
        expect(flat.find(item => item.key === 'Rating XMP')?.value).toBe(3);

        const grouped = groupMetadataForDisplay(summary, tile);
        expect(grouped.highlights[0].value).toBe('Clip title');
        expect(grouped.lead.some(item => item.key === 'format.codec')).toBe(true);
    });

    it('groups remaining image EXIF into lead and more', () => {
        const { lead, more } = groupPhotoMetadata([
            { key: 'x-Camera', value: 'Fujifilm X-T5' },
            { key: 'Make', value: 'FUJIFILM' },
        ]);
        expect(lead[0].key).toBe('x-Camera');
        expect(more[0].key).toBe('Make');
    });

    it('leaves unset fields out of the hero and lists the important ones as missing', () => {
        const { highlights, missing } = groupMetadataForDisplay([{ key: 'x-Camera', value: 'Pixel 8' }], { isImage: true });
        expect(highlights).toEqual([]);
        expect(missing).toEqual(['Title', 'Description', 'Rating', 'Date taken', 'Location']);
    });

    it('drops empty and bookkeeping fields and raw values a friendlier row already shows', () => {
        const summary = [
            { key: 'x-Camera', value: 'Google Pixel 9 Pro Fold' },
            { key: 'Make', value: 'Google' },
            { key: 'x-Settings', value: 'ƒ/1.8 · 1/125 s · ISO 100 · 26 mm' },
            { key: 'FNumber', value: '1.8' },
            { key: 'ExposureTime', value: '0.008' },
            { key: 'JFIFVersion', value: '257' },
            { key: 'ThumbnailWidth', value: '0' },
            { key: 'Artist', value: '   ' },
            { key: 'ImageDescription', value: 'undefined' },
            { key: 'Flash', value: 'Flash did not fire' },
        ];
        const { lead, more } = groupMetadataForDisplay(summary, { isImage: true });
        expect(lead.map(item => item.key)).toEqual(['x-Camera', 'x-Settings']);
        expect(more.map(item => item.key)).toEqual(['Flash']);
    });

    it('adds the colour label and keywords to the hero and keeps location', () => {
        const summary = [
            { key: 'Rating XMP', value: 4 },
            { key: 'Label XMP', value: 'Green' },
            { key: 'Keywords XMP', value: 'sunset, lake, sunset' },
            { key: 'x-Location', value: { lat: 47.36, long: 8.54 } },
            { key: 'LensModel', value: 'RF24-70mm' },
            { key: 'x-Camera', value: 'Canon EOS R5' },
            { key: 'DateTimeOriginal', value: 'Oct 15 2026' },
        ];
        const { highlights, lead } = groupMetadataForDisplay(summary, { isImage: true });
        const rating = highlights.find(h => h.kind === 'rating');
        expect(rating.value).toBe(4);
        expect(rating.colorLabel).toBe('Green');
        expect(highlights.find(h => h.kind === 'keywords').value).toEqual(['sunset', 'lake']);
        expect(lead.map(item => item.key)).toEqual(['DateTimeOriginal', 'x-Location', 'x-Camera', 'LensModel']);
    });

    it('reads video descriptions from music-metadata comment objects', () => {
        const summary = [{ key: 'common', value: { comment: [{ text: 'Shot on the pier' }] } }];
        const { highlights } = groupMetadataForDisplay(summary, { isVideo: true });
        expect(highlights.find(h => h.kind === 'description').value).toBe('Shot on the pier');
    });

    it('says values the way people do', () => {
        expect(humanizeMetadataValue('ExposureTime', '0.008')).toBe('1/125 s');
        expect(humanizeMetadataValue('ExposureTime', 2)).toBe('2 s');
        expect(humanizeMetadataValue('FNumber', 1.8)).toBe('ƒ/1.8');
        expect(humanizeMetadataValue('FocalLength', '6.4')).toBe('6.4 mm');
        expect(humanizeMetadataValue('ExposureCompensation', '0')).toBe('±0 EV');
        expect(humanizeMetadataValue('ExposureCompensation', -0.67)).toBe('−0.7 EV');
        expect(humanizeMetadataValue('x-Pixel Size', '4000 x 3000')).toBe('4000 × 3000 · 12 MP');
        expect(humanizeMetadataValue('GPSAltitude', '191.5')).toBe('192 m');
        expect(humanizeMetadataValue('format.sampleRate', 44100)).toBe('44.1 kHz');
        expect(humanizeMetadataValue('format.bitrate', '1200000 bps')).toBe('1.2 Mbps');
        expect(humanizeMetadataValue('Flash', 'Flash fired, auto mode')).toBe('Flash fired');
        expect(humanizeMetadataValue('LensModel', 'RF24-70mm')).toBe('RF24-70mm');
    });

    it('lets details shared in the room override the file, including a clear', () => {
        const summary = [
            { key: 'Title XMP', value: 'From the camera' },
            { key: 'x-Description', value: 'Embedded caption' },
            { key: 'Rating XMP', value: 2 },
        ];
        const tile = { isImage: true, details: {
            title: 'Our harbour', description: '', rating: 5,
            editedBy: { peerId: 'p2', name: 'Bob' }, editedAt: 1000,
        } };
        const grouped = groupMetadataForDisplay(summary, tile);
        expect(grouped.highlights.map(h => [h.kind, h.value])).toEqual([['title', 'Our harbour'], ['rating', 5]]);
        expect(grouped.values).toEqual({ title: 'Our harbour', description: '', rating: 5 });
        expect(grouped.editedBy.name).toBe('Bob');
        expect(grouped.missing).toContain('Description');
    });

    it('shows shared details before the file metadata has been read', () => {
        const grouped = groupMetadataForDisplay(null, { isImage: true, details: { title: 'Early', rating: 3 } });
        expect(grouped.highlights.map(h => h.kind)).toEqual(['title', 'rating']);
    });
});
