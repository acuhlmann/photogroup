import { describe, it, expect } from 'vitest';
import { shouldCacheBlob } from './ImageBlobCache';

describe('ImageBlobCache', () => {
    it('only caches image MIME types', () => {
        expect(shouldCacheBlob('image/jpeg')).toBe(true);
        expect(shouldCacheBlob('image/png')).toBe(true);
        expect(shouldCacheBlob('video/mp4')).toBe(false);
        expect(shouldCacheBlob('audio/mpeg')).toBe(false);
        expect(shouldCacheBlob(undefined)).toBe(false);
    });
});
