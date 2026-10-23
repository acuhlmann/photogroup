import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

vi.mock('downloadjs', () => ({ default: vi.fn() }));
vi.mock('../gallery/saveRoom', async (importOriginal) => ({
    ...(await importOriginal()),
    saveRoom: vi.fn().mockResolvedValue({ saved: 2, skipped: 0 }),
}));

const { default: download } = await import('downloadjs');
const { saveRoom } = await import('../gallery/saveRoom');
const { saveToDevice, canShareFiles } = await import('./saveToDevice');

const photo = name => ({ elem: new Blob([new Uint8Array([1, 2, 3])]), fileName: name, fileType: 'image/jpeg' });

function onPhone({ share }) {
    window.matchMedia = query => ({ matches: query === '(pointer: coarse)', media: query, addListener() {}, removeListener() {} });
    navigator.canShare = () => true;
    navigator.share = share;
}

describe('saveToDevice', () => {
    const matchMedia = window.matchMedia;
    beforeEach(() => download.mockClear());
    afterEach(() => {
        window.matchMedia = matchMedia;
        delete navigator.canShare;
        delete navigator.share;
    });

    it('downloads one photo on a computer', async () => {
        expect(canShareFiles()).toBe(false);
        expect(await saveToDevice([photo('a.jpg')])).toBe('saved');
        expect(download).toHaveBeenCalledWith(expect.anything(), 'a.jpg');
    });

    it('zips several photos on a computer', async () => {
        const tiles = [photo('a.jpg'), photo('b.jpg')];
        await saveToDevice(tiles, { roomId: 'r1' });
        expect(saveRoom).toHaveBeenCalledWith(tiles, { roomId: 'r1' });
    });

    it('opens the share sheet on a phone, with every photo and unique names', async () => {
        const share = vi.fn().mockResolvedValue();
        onPhone({ share });
        expect(await saveToDevice([photo('a.jpg'), photo('a.jpg')])).toBe('shared');
        const files = share.mock.calls[0][0].files;
        expect(files.map(file => file.name)).toEqual(['a.jpg', 'a (2).jpg']);
        expect(download).not.toHaveBeenCalled();
    });

    it('does nothing more when the share sheet is closed', async () => {
        const abort = Object.assign(new Error('cancel'), { name: 'AbortError' });
        onPhone({ share: vi.fn().mockRejectedValue(abort) });
        expect(await saveToDevice([photo('a.jpg')])).toBe('cancelled');
        expect(download).not.toHaveBeenCalled();
    });

    it('downloads instead when the share sheet is refused', async () => {
        const refused = Object.assign(new Error('no'), { name: 'NotAllowedError' });
        onPhone({ share: vi.fn().mockRejectedValue(refused) });
        expect(await saveToDevice([photo('a.jpg')])).toBe('saved');
        expect(download).toHaveBeenCalled();
    });

    it('leaves out photos still arriving, and fails when none are here', async () => {
        const arriving = { fileName: 'c.jpg', torrentFile: { done: false } };
        await saveToDevice([photo('a.jpg'), arriving]);
        expect(download).toHaveBeenCalledWith(expect.anything(), 'a.jpg');
        await expect(saveToDevice([arriving])).rejects.toThrow('Not here yet');
    });
});
