import { describe, it, expect } from 'vitest';
import {
    flattenMetadataSummary,
    groupMetadataForDisplay,
    groupPhotoMetadata,
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

    it('always offers title, rating and description, marking missing ones', () => {
        const { highlights } = groupMetadataForDisplay([{ key: 'x-Camera', value: 'Pixel 8' }], { isImage: true });
        expect(highlights.map(h => [h.kind, h.value])).toEqual([
            ['title', null], ['rating', null], ['description', null],
        ]);
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
});
