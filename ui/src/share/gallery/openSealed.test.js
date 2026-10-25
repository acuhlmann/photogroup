import { describe, it, expect } from 'vitest';
import { withOpenedName } from './openSealed';

describe('withOpenedName', () => {
    const opened = { secure: true, isDecrypted: true, fileName: 'IMG_1.jpg', fileType: 'image/jpeg' };

    it('keeps the real name of an opened photo when the server sends the sealed one', () => {
        expect(withOpenedName(opened, { infoHash: 'h', fileName: 'photo-x-0', rating: 3 })).toEqual({ infoHash: 'h', rating: 3 });
        expect(withOpenedName({ ...opened, isDecrypted: false, seed: true }, { fileName: 'photo-x-0' })).toEqual({});
    });

    it('lets a photo take its name when it is opened, and leaves other rooms\' photos alone', () => {
        const update = { fileName: 'IMG_1.jpg', isDecrypted: true };
        expect(withOpenedName({ secure: true, fileName: 'photo-x-0' }, update)).toBe(update);
        const plain = { fileName: 'new.jpg' };
        expect(withOpenedName({ fileName: 'old.jpg' }, plain)).toBe(plain);
    });
});
