import { describe, it, expect } from 'vitest';
import { packSheet, readSheet, packBundle, readBundle, encodePick, decodePick, fitsBundle, MAX_THUMB_BYTES, MAX_SHEET_ITEMS } from './lightBundle';
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

describe('photos by camera, small pictures first', () => {
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

    it('carries a bundle: the picked photos in full', () => {
        const parts = readBundle(through(packBundle([
            { id: 'a', name: 'one.jpg', type: 'image/jpeg', bytes: bytes(5000, 1), about: { infoHash: 'a', fileName: 'one.jpg' } },
            { id: 'b', name: 'two.jpg', type: 'image/jpeg', bytes: bytes(1, 2), sealed: true },
        ], { room: 77 })));
        expect(parts.map(part => part.details)).toEqual([
            { id: 'a', name: 'one.jpg', type: 'image/jpeg', sealed: false, room: 77, about: { infoHash: 'a', fileName: 'one.jpg' } },
            { id: 'b', name: 'two.jpg', type: 'image/jpeg', sealed: true, room: 77 },
        ]);
        expect(parts[0].file).toEqual(bytes(5000, 1));
        expect(parts[1].file).toEqual(bytes(1, 2));
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

    it('carries the choice in one small code', () => {
        const code = encodePick(0xdeadbeef, [3, 0, 3, 59, 60, -1]);
        expect(code.length).toBe(8 + 3);
        expect(decodePick(code)).toEqual({ sendId: 0xdeadbeef, indexes: [3, 0, 59] });
        expect(decodePick(bytes(11))).toBeNull();
        expect(decodePick(code.subarray(0, 9))).toBeNull();
    });

    it('says when photos are too large together', () => {
        expect(fitsBundle([MAX_LIGHT_BYTES - 1, 1])).toBe(true);
        expect(fitsBundle([MAX_LIGHT_BYTES, 1])).toBe(false);
    });
});
