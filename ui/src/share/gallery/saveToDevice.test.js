import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

vi.mock('downloadjs', () => ({ default: vi.fn() }));
vi.mock('./saveRoom', async (importOriginal) => ({
    ...(await importOriginal()),
    saveRoom: vi.fn().mockResolvedValue({ saved: 2, skipped: 0 }),
}));

const { default: download } = await import('downloadjs');
const { saveRoom } = await import('./saveRoom');
const { saveToDevice, canShareFiles, phoneKind, saveWay, savedWhereText } = await import('./saveToDevice');

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

describe('where saving goes', () => {
    const matchMedia = window.matchMedia;
    const agent = Object.getOwnPropertyDescriptor(window.navigator, 'userAgent');
    const setAgent = value => Object.defineProperty(window.navigator, 'userAgent', { value, configurable: true });
    beforeEach(() => saveRoom.mockClear());
    afterEach(() => {
        if (agent) Object.defineProperty(window.navigator, 'userAgent', agent);
        else delete window.navigator.userAgent;
        window.matchMedia = matchMedia;
        delete navigator.canShare;
        delete navigator.share;
        download.mockClear();
    });

    it('knows iPhones, iPads that say they are a Mac, and Android', () => {
        setAgent('Mozilla/5.0 (iPhone; CPU iPhone OS 18_0 like Mac OS X)');
        expect(phoneKind()).toBe('ios');
        setAgent('Mozilla/5.0 (Linux; Android 15; Pixel 9)');
        expect(phoneKind()).toBe('android');
        setAgent('Mozilla/5.0 (X11; Linux x86_64)');
        expect(phoneKind()).toBe(null);
    });

    it('downloads each photo on Android, so the gallery app shows them, and never a zip', async () => {
        setAgent('Mozilla/5.0 (Linux; Android 15; Pixel 9)');
        navigator.canShare = () => true;
        navigator.share = vi.fn();
        expect(saveWay()).toBe('each');
        expect(await saveToDevice([photo('a.jpg'), photo('b.jpg')])).toBe('saved');
        expect(navigator.share).not.toHaveBeenCalled();
        expect(saveRoom).not.toHaveBeenCalledWith(expect.anything(), expect.anything());
        expect(download.mock.calls.map(call => call[1])).toEqual(['a.jpg', 'b.jpg']);
        expect(savedWhereText(2)).toBe('They go to your gallery app, in the Download album.');
    });

    it('shares files made before the tap as they are', async () => {
        const share = vi.fn().mockResolvedValue();
        window.matchMedia = query => ({ matches: query === '(pointer: coarse)', media: query, addListener() {}, removeListener() {} });
        navigator.canShare = () => true;
        navigator.share = share;
        const made = new File(['m'], 'made.jpg', { type: 'image/jpeg' });
        await saveToDevice([{ ...photo('a.jpg'), tileKey: 'k' }], { files: new Map([['k', made]]) });
        expect(share.mock.calls[0][0].files[0]).toBe(made);
        expect(savedWhereText(1)).toBe('Tap "Save" in the list that opens. It goes to your Photos app.');
        expect(savedWhereText(3, { done: true })).toBe('They are in your Photos app.');
    });

    it('says where a computer puts them', () => {
        expect(savedWhereText(1, { way: 'download' })).toBe('It goes to the Downloads folder of this computer.');
        expect(savedWhereText(4, { way: 'download' })).toBe('One zip file goes to the Downloads folder of this computer.');
    });

    it('says the folder was the person\'s own choice', () => {
        expect(savedWhereText(1, { way: 'chosen' })).toBe('It is in the folder you chose.');
        expect(savedWhereText(2, { way: 'chosen' })).toBe('They are in the folders you chose.');
    });
});
