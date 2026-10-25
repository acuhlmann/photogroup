import { describe, it, expect } from 'vitest';
import {
    importRoomKey, isSealedText, keyFromHash, newRoomKey, openFile, openText, sealFile, sealText,
} from './roomKey';

describe('roomKey', () => {
    it('makes a key that fits in a link and reads it back from "#k="', () => {
        const key = newRoomKey();
        expect(key).toMatch(/^[A-Za-z0-9_-]{43}$/);
        expect(keyFromHash('#k=' + key)).toBe(key);
        expect(keyFromHash('#k=short')).toBeNull();
        expect(keyFromHash('')).toBeNull();
    });

    it('seals a file under a neutral name and opens it with its name, type and bytes', async () => {
        const key = await importRoomKey(newRoomKey());
        const photo = new File(['beach pixels'], 'IMG_0042.jpg', { type: 'image/jpeg', lastModified: 1700000000000 });
        const sealed = await sealFile(key, photo, 'photo-abc-0');
        expect(sealed.name).toBe('photo-abc-0');
        expect(sealed.type).toBe('application/octet-stream');
        expect(await sealed.text()).not.toContain('beach');

        const opened = await openFile(key, sealed);
        expect(opened.name).toBe('IMG_0042.jpg');
        expect(opened.type).toBe('image/jpeg');
        expect(opened.lastModified).toBe(1700000000000);
        expect(await opened.text()).toBe('beach pixels');
    });

    it('cannot open a file with another room\'s key', async () => {
        const key = await importRoomKey(newRoomKey());
        const other = await importRoomKey(newRoomKey());
        const sealed = await sealFile(key, new File(['x'], 'a.jpg'), 'photo-a-0');
        await expect(openFile(other, sealed)).rejects.toThrow();
    });

    it('seals and opens a room name', async () => {
        const key = await importRoomKey(newRoomKey());
        const sealed = await sealText(key, 'Beach day');
        expect(isSealedText(sealed)).toBe(true);
        expect(sealed).toMatch(/^sealed:[A-Za-z0-9_-]+$/);
        expect(await openText(key, sealed)).toBe('Beach day');
        expect(isSealedText('Beach day')).toBe(false);
    });
});
