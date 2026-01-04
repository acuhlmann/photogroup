/**
 * Unit tests for ThumbnailExtractor
 */
import { describe, it, expect } from 'vitest';
import {
    isThumbnail,
    getOriginalFilename
} from '../ThumbnailExtractor';

// Note: getPreviewFromImage, getPreviewFromAudio, and extractThumbnails
// require browser APIs (Canvas, Image, URL.createObjectURL) and external
// dependencies (exifr, music-metadata-browser) that are difficult to mock.
// These functions are better tested in integration/e2e tests.
// Here we test the pure utility functions.

describe('ThumbnailExtractor', () => {
    describe('isThumbnail', () => {
        it('should return true for thumbnail file', () => {
            expect(isThumbnail({ name: 'Thumbnail photo.jpg' })).toBe(true);
        });

        it('should return false for regular file', () => {
            expect(isThumbnail({ name: 'photo.jpg' })).toBe(false);
        });

        it('should return false for null input', () => {
            expect(isThumbnail(null)).toBe(false);
        });

        it('should return false for undefined input', () => {
            expect(isThumbnail(undefined)).toBe(false);
        });

        it('should return false for file without name', () => {
            expect(isThumbnail({})).toBe(false);
        });

        it('should be case-sensitive', () => {
            expect(isThumbnail({ name: 'thumbnail photo.jpg' })).toBe(false);
            expect(isThumbnail({ name: 'THUMBNAIL photo.jpg' })).toBe(false);
        });

        it('should work with File objects', () => {
            // Simulate a File object (in tests, we can't create real File objects easily)
            const mockFile = { name: 'Thumbnail image.png' };
            expect(isThumbnail(mockFile)).toBe(true);
        });
    });

    describe('getOriginalFilename', () => {
        it('should extract original filename from thumbnail name', () => {
            expect(getOriginalFilename('Thumbnail photo.jpg')).toBe('photo.jpg');
        });

        it('should return null for non-thumbnail name', () => {
            expect(getOriginalFilename('photo.jpg')).toBeNull();
        });

        it('should return null for null input', () => {
            expect(getOriginalFilename(null)).toBeNull();
        });

        it('should return null for undefined input', () => {
            expect(getOriginalFilename(undefined)).toBeNull();
        });

        it('should return null for empty string', () => {
            expect(getOriginalFilename('')).toBeNull();
        });

        it('should return null for non-string input', () => {
            expect(getOriginalFilename(123)).toBeNull();
            expect(getOriginalFilename({})).toBeNull();
        });

        it('should handle filenames with spaces', () => {
            expect(getOriginalFilename('Thumbnail my vacation photo.jpg')).toBe('my vacation photo.jpg');
        });

        it('should handle filenames with special characters', () => {
            expect(getOriginalFilename('Thumbnail image (1).png')).toBe('image (1).png');
        });

        it('should handle empty original filename', () => {
            expect(getOriginalFilename('Thumbnail ')).toBe('');
        });
    });
});

