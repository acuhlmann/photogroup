import { describe, it, expect, vi } from 'vitest';

vi.mock('downloadjs', () => ({ default: vi.fn() }));

const { default: download } = await import('downloadjs');
const { savePhoto } = await import('./savePhoto');

describe('savePhoto', () => {
    it('hands the file to the browser with the shared details embedded', async () => {
        const elem = new Blob([new Uint8Array([0x47, 0x49, 0x46])]);
        await savePhoto({ elem, fileName: 'a.gif', details: { title: 'T' } });
        expect(download).toHaveBeenCalledWith(elem, 'a.gif');
    });

    it('rejects when the download itself fails, so the Save button recovers', async () => {
        download.mockImplementationOnce(() => { throw new Error('blocked'); });
        const elem = new Blob([new Uint8Array([1, 2, 3])]);
        await expect(savePhoto({ elem, fileName: 'b.bin' })).rejects.toThrow('blocked');
    });
});
