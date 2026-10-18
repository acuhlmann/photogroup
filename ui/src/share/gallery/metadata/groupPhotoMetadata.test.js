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

        expect(highlights.map(h => h.kind)).toEqual(['title', 'description', 'rating']);
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
});
