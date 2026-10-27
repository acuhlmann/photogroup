import { describe, it, expect, vi } from 'vitest';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';

// jsdom's Blob has no stream(), which browsers have and client-zip reads files with.
if (!('stream' in Blob.prototype)) {
    Object.defineProperty(Blob.prototype, 'stream', {
        value() {
            const blob = this;
            return new ReadableStream({
                async start(controller) {
                    controller.enqueue(new Uint8Array(await blob.arrayBuffer()));
                    controller.close();
                },
            });
        },
    });
}
const { isReadyToSave, saveRoom, zipEntryNames, zipName } = await import('./saveRoom');
const { alreadyHave, clearHave } = await import('./alreadyHave');

const photo = () => new Blob([readFileSync(join(__dirname, 'metadata/embed/__fixtures__/photo.jpg'))]);
const text = bytes => new TextDecoder().decode(bytes);

/** Each entry of a stored (uncompressed) zip as { name, bytes, date }, read from its central directory. */
async function readZip(blob) {
    const bytes = new Uint8Array(await blob.arrayBuffer());
    const view = new DataView(bytes.buffer);
    let end = bytes.length - 22;
    while (view.getUint32(end, true) !== 0x06054b50) end--;
    const entries = [];
    let at = view.getUint32(end + 16, true);
    for (let index = 0; index < view.getUint16(end + 10, true); index++) {
        expect(view.getUint32(at, true)).toBe(0x02014b50);
        expect(view.getUint16(at + 10, true)).toBe(0); // stored
        const size = view.getUint32(at + 20, true);
        const nameLength = view.getUint16(at + 28, true);
        const local = view.getUint32(at + 42, true);
        const dosDate = view.getUint16(at + 14, true);
        const start = local + 30 + view.getUint16(local + 26, true) + view.getUint16(local + 28, true);
        entries.push({
            name: text(bytes.subarray(at + 46, at + 46 + nameLength)),
            bytes: bytes.subarray(start, start + size),
            date: [(dosDate >> 9) + 1980, (dosDate >> 5) & 15, dosDate & 31],
        });
        at += 46 + nameLength + view.getUint16(at + 30, true) + view.getUint16(at + 32, true);
    }
    return entries;
}

describe('saveRoom', () => {
    it('names every photo uniquely, ignoring case', () => {
        expect(zipEntryNames([
            { fileName: 'beach.jpg' }, { fileName: 'Beach.JPG' }, { fileName: 'beach.jpg' }, { fileName: 'a/b' }, {},
        ])).toEqual(['beach.jpg', 'Beach (2).JPG', 'beach (3).jpg', 'a_b', 'photo']);
        expect(zipName('a1b2-c3')).toBe('photogroup-a1b2-c3.zip');
        expect(zipName(undefined)).toBe('photogroup-room.zip');
    });

    it('only saves photos that are here in full', () => {
        expect(isReadyToSave({ elem: new Blob([]) })).toBe(true);
        expect(isReadyToSave({ torrentFile: { done: true, getBlob() {} } })).toBe(true);
        expect(isReadyToSave({ torrentFile: { done: false, getBlob() {} } })).toBe(false);
        // WebTorrent 2+ files read through blob().
        expect(isReadyToSave({ torrentFile: { done: true, blob: async () => new Blob([]) } })).toBe(true);
        expect(isReadyToSave({})).toBe(false);
    });

    it('zips the room with each photo’s details written into it', async () => {
        const save = vi.fn();
        const progress = vi.fn();
        clearHave();
        const fp = letter => '3:' + letter.repeat(64);
        const fromPeer = {
            fileName: 'pier.jpg', details: { title: 'At the pier' }, fingerprint: fp('b'),
            torrentFile: { done: true, getBlob: callback => callback(null, photo()) },
        };
        const tiles = [
            { elem: photo(), fileName: 'pier.jpg', details: { title: 'Sunset swim', keywords: ['sea'] }, picDateTakenDate: new Date(2026, 9, 12, 18, 30), fingerprint: fp('a') },
            fromPeer,
            { fileName: 'arriving.jpg', torrentFile: { done: false, getBlob() {} }, fingerprint: fp('c') },
            { fileName: 'broken.jpg', torrentFile: { done: true, getBlob: callback => callback(new Error('gone')) }, fingerprint: fp('d') },
        ];

        const result = await saveRoom(tiles, { roomId: 'r1', onProgress: progress, save });
        expect(result).toEqual({ saved: 2, skipped: 2 });
        expect(progress).toHaveBeenLastCalledWith(3, 3);
        expect(save).toHaveBeenCalledWith(expect.objectContaining({ size: expect.any(Number) }), 'photogroup-r1.zip', 'application/zip');

        const entries = await readZip(save.mock.calls[0][0]);
        expect(entries.map(entry => entry.name)).toEqual(['pier.jpg', 'pier (2).jpg']);
        expect([...entries[0].bytes.subarray(0, 2)]).toEqual([0xff, 0xd8]);
        expect(text(entries[0].bytes)).toContain('Sunset swim');
        expect(text(entries[1].bytes)).toContain('At the pier');
        expect(entries[0].date).toEqual([2026, 10, 12]);
        // Only the photos that went into the zip count as saved.
        expect(tiles.map(tile => alreadyHave(tile))).toEqual(['saved', 'saved', null, null]);
    });

    // The save dialog can be closed without choosing, which is not a save.
    it('does not count the room as had when the chosen folder is refused', async () => {
        clearHave();
        const tile = { elem: photo(), fileName: 'pier.jpg', fingerprint: '6:' + 'e'.repeat(64) };
        const cancelled = Object.assign(new Error('closed'), { name: 'AbortError', cancelled: true });
        const save = vi.fn().mockRejectedValue(cancelled);

        await expect(saveRoom([tile], { roomId: 'r1', save })).rejects.toThrow('closed');
        expect(save).toHaveBeenCalled();
        expect(alreadyHave(tile)).toBe(null);
    });

    it('says so when nothing is ready yet', async () => {
        await expect(saveRoom([{ fileName: 'a.jpg' }], { save: vi.fn() })).rejects.toThrow('No photos are ready');
    });
});
