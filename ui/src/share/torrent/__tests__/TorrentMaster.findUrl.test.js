import { describe, it, expect } from 'vitest';
import TorrentMaster from '../TorrentMaster';

describe('TorrentMaster.findUrl', () => {
    // Test findUrl directly via prototype - it's a pure function that doesn't use `this`
    const findUrl = TorrentMaster.prototype.findUrl;

    it('should return the photo when infoHash matches', () => {
        const photos = [
            { infoHash: 'abc123', name: 'photo1.jpg' },
            { infoHash: 'def456', name: 'photo2.jpg' },
        ];
        const result = findUrl(photos, 'def456');
        expect(result).toEqual({ infoHash: 'def456', name: 'photo2.jpg' });
    });

    it('should return null when infoHash is not found', () => {
        const photos = [
            { infoHash: 'abc123', name: 'photo1.jpg' },
        ];
        const result = findUrl(photos, 'nonexistent');
        expect(result).toBeNull();
    });

    it('should return the first photo when infoHash matches at index 0', () => {
        const photos = [
            { infoHash: 'abc123', name: 'photo1.jpg' },
            { infoHash: 'def456', name: 'photo2.jpg' },
        ];
        const result = findUrl(photos, 'abc123');
        expect(result).toEqual({ infoHash: 'abc123', name: 'photo1.jpg' });
    });

    it('should return null for empty photos array', () => {
        const result = findUrl([], 'abc123');
        expect(result).toBeNull();
    });
});
