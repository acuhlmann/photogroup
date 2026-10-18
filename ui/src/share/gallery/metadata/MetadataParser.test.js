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
