import { describe, it, expect } from 'vitest';
import { packSheet, readSheet, packBundle, readBundle, encodePick, decodePick, fitsBundle, bytesInSize, canBeSmall, smallName, MAX_THUMB_BYTES, MAX_SHEET_ITEMS, MAX_BUNDLE_BYTES, MAX_DETAILS_BYTES, SMALL_MAX_BYTES } from './lightBundle';
import { createLightSender, createLightReceiver, MAX_LIGHT_BYTES } from './lightFrames';

const bytes = (length, seed = 1) => Uint8Array.from({ length }, (unused, i) => (i * 7 + seed) & 0xff);

// Through the codes, as a camera reads them.
function through({ details, file }) {
    const sender = createLightSender(details, file, 420);
    const receiver = createLightReceiver();
    let state = null;
    for (let i = 0; i < 5000 && !state?.done; i++) state = receiver.add(sender.next());
    expect(state.done).toBe(true);
    return receiver.result();
}

describe('photos by camera, previews first', () => {
    it('carries a sheet: name, size and small picture of each photo', () => {
        const sheet = readSheet(through(packSheet([
            { id: 'a', name: 'one.jpg', type: 'image/jpeg', size: 4000000, thumb: bytes(3000, 1) },
            { id: 'b', name: 'clip.mp4', type: 'video/mp4', size: 9000000, thumb: null },
            { id: 'c', name: 'sealed', type: '', size: 500, sealed: true, thumb: bytes(MAX_THUMB_BYTES + 1) },
        ], { room: 1234 })));
        expect(sheet.room).toBe(1234);
        expect(sheet.items.map(item => [item.id, item.name, item.size, item.sealed, item.thumb?.length || 0])).toEqual([
            ['a', 'one.jpg', 4000000, false, 3000],
            ['b', 'clip.mp4', 9000000, false, 0],
            // A small picture that is too large stays out.
            ['c', 'sealed', 500, true, 0],
        ]);
        expect(sheet.items[0].thumb).toEqual(bytes(3000, 1));
    });

    it('carries a bundle: the picked photos, each in full or in small size', () => {
        const parts = readBundle(through(packBundle([
            { id: 'a', name: 'one.jpg', type: 'image/jpeg', bytes: bytes(5000, 1), about: { infoHash: 'a', fileName: 'one.jpg' } },
            { id: 'b', name: 'two.jpg', type: 'image/jpeg', bytes: bytes(1, 2), sealed: true },
            { id: 'c', name: 'clip.mp4', type: 'video/mp4', bytes: bytes(900, 3), small: true },
        ], { room: 77 })));
        expect(parts.map(part => part.details)).toEqual([
            { id: 'a', name: 'one.jpg', type: 'image/jpeg', sealed: false, room: 77, about: { infoHash: 'a', fileName: 'one.jpg' } },
            { id: 'b', name: 'two.jpg', type: 'image/jpeg', sealed: true, room: 77 },
            // The type stays the photo's: the bytes are a JPEG of it.
            { id: 'c', name: 'clip.mp4', type: 'video/mp4', sealed: false, small: true, room: 77 },
        ]);
        expect(parts[0].file).toEqual(bytes(5000, 1));
        expect(parts[1].file).toEqual(bytes(1, 2));
        expect(parts[2].file).toEqual(bytes(900, 3));
    });

    it('knows which photos can go in small size, and about how large they are then', () => {
        const photo = { type: 'image/heic', size: 3000000 };
        const clip = { type: 'video/mp4', size: 40000000 };
        expect(canBeSmall(photo)).toBe(true);
        expect(canBeSmall(clip)).toBe(true);
        expect(canBeSmall({ ...photo, sealed: true })).toBe(false);
        expect(canBeSmall({ type: 'application/pdf', size: 1 })).toBe(false);
        expect(bytesInSize(photo, true)).toBe(SMALL_MAX_BYTES);
        expect(bytesInSize(photo, false)).toBe(3000000);
        // Small already: it goes as it is.
        expect(bytesInSize({ type: 'image/jpeg', size: 4000 }, true)).toBe(4000);
        expect(bytesInSize({ ...photo, sealed: true }, true)).toBe(3000000);
    });

    it('names a photo in small size', () => {
        expect(smallName('beach.heic')).toBe('beach (small).jpg');
        expect(smallName('clip.final.mp4')).toBe('clip.final (small).jpg');
        expect(smallName('')).toBe('photo (small).jpg');
    });

    it('knows a sheet from a bundle from one photo', () => {
        const one = { details: { id: 'a', name: 'a.jpg', type: 'image/jpeg' }, file: bytes(10) };
        expect(readSheet(one)).toBeNull();
        expect(readBundle(one)).toBeNull();
        expect(readBundle(packSheet([{ id: 'a', name: 'a', type: '', size: 1 }]))).toBeNull();
    });

    it('refuses a sheet or a bundle whose sizes do not fit its bytes', () => {
        expect(readSheet({ details: { kind: 'sheet', items: [{ id: 'a', thumb: 50 }] }, file: bytes(10) })).toBeNull();
        expect(readBundle({ details: { kind: 'bundle', items: [{ id: 'a', size: -1 }] }, file: bytes(10) })).toBeNull();
        expect(readBundle({ details: { kind: 'bundle', items: [] }, file: bytes(10) })).toBeNull();
        expect(readSheet({ details: { kind: 'sheet', items: Array.from({ length: MAX_SHEET_ITEMS + 1 }, () => ({ id: 'a', thumb: 0 })) }, file: bytes(1) })).toBeNull();
    });

    it('carries the choice and the size in one small code', () => {
        const code = encodePick(0xdeadbeef, [3, 0, 3, 59, 60, -1]);
        expect(code.length).toBe(9 + 3);
        expect(decodePick(code)).toEqual({ sendId: 0xdeadbeef, indexes: [3, 0, 59], small: true });
        expect(decodePick(encodePick(7, [1], { small: false }))).toEqual({ sendId: 7, indexes: [1], small: false });
        expect(decodePick(bytes(11))).toBeNull();
        expect(decodePick(code.subarray(0, 10))).toBeNull();
    });

    it('reads a choice from a phone with the app from before the size choice as full size', () => {
        const old = Uint8Array.from([0x50, 0x4b, 1, 2, 0, 0, 0, 9, 4, 5]);
        expect(decodePick(old)).toEqual({ sendId: 9, indexes: [4, 5], small: false });
    });

    it('says when photos are too large together', () => {
        expect(fitsBundle([MAX_BUNDLE_BYTES - 1, 1])).toBe(true);
        expect(fitsBundle([MAX_BUNDLE_BYTES, 1])).toBe(false);
        // The largest bundle with the longest details is a stream that the other phone takes.
        expect(2 + MAX_DETAILS_BYTES + MAX_BUNDLE_BYTES).toBeLessThanOrEqual(MAX_LIGHT_BYTES + 4096);
    });

    it('leaves out the longest descriptions when the details are too long', () => {
        const long = { note: 'x'.repeat(40000) };
        const packed = packBundle([
            { id: 'a', name: 'a.jpg', type: 'image/jpeg', bytes: bytes(10), about: { note: 'short' } },
            { id: 'b', name: 'b.jpg', type: 'image/jpeg', bytes: bytes(20), about: long },
            { id: 'c', name: 'c.jpg', type: 'image/jpeg', bytes: bytes(30), about: { note: 'x'.repeat(30000) } },
        ]);
        expect(packed.details.items.map(item => !!item.about)).toEqual([true, false, true]);
        const parts = readBundle(through(packed));
        expect(parts.map(part => part.file.length)).toEqual([10, 20, 30]);
        expect(parts[0].details.about).toEqual({ note: 'short' });
    });

    it('does not start a stream whose details are too long', () => {
        expect(() => createLightSender({ note: 'x'.repeat(70000) }, bytes(10), 420)).toThrow(RangeError);
    });
});
