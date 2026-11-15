import { describe, it, expect } from 'vitest';
import { encodeNotes, decodeNotes, notesText, parseNotesText, roomTag, photoMark, peerMark, cutUtf8, SOUND_FRAME_BYTES, NOTE_NAME_BYTES } from './notes';

const ROOM = 'z45keexwrxqzbeqimgsz';
const FROM = peerMark('2d5757303330302d6b4c4f7a3351794d4a6b5a41');

describe('notes', () => {
    it('carries a name and a star rating in a few bytes', () => {
        const [frame, ...more] = encodeNotes({ room: ROOM, from: FROM, notes: [
            { type: 'name', name: 'Anna' },
            { type: 'rating', photo: 'abc123', rating: 4 },
            { type: 'rating', photo: 'def456', rating: -1 },
        ] });
        expect(more).toHaveLength(0);
        expect(frame.length).toBe(8 + 6 + 6 + 6);
        expect(decodeNotes(frame)).toEqual({
            roomTag: roomTag(ROOM),
            from: FROM,
            notes: [
                { type: 'name', name: 'Anna' },
                { type: 'rating', mark: photoMark('abc123'), rating: 4 },
                { type: 'rating', mark: photoMark('def456'), rating: -1 },
            ],
        });
    });

    it('cuts a long list of photos into frames that fit the channel', () => {
        const photos = Array.from({ length: 40 }, (_, i) => 'photo' + i);
        const frames = encodeNotes({ room: ROOM, from: FROM, notes: [{ type: 'name', name: 'Anna' }, { type: 'have', photos }] });
        expect(frames.length).toBeGreaterThan(1);
        const marks = [];
        frames.forEach((frame) => {
            expect(frame.length).toBeLessThanOrEqual(SOUND_FRAME_BYTES);
            // ggwave takes 140 characters at the most.
            expect(notesText(frame).length).toBeLessThanOrEqual(140);
            decodeNotes(frame).notes.filter(note => note.type === 'have').forEach((note) => {
                expect(note.total).toBe(40);
                marks.push(...note.marks);
            });
        });
        expect(marks).toEqual(photos.map(photoMark));
    });

    it('says "no photos" with an empty list', () => {
        const [frame] = encodeNotes({ room: ROOM, from: FROM, notes: [{ type: 'have', photos: [] }] });
        expect(decodeNotes(frame).notes).toEqual([{ type: 'have', total: 0, marks: [] }]);
    });

    it('cuts a long name between characters', () => {
        const name = 'Åsa-Ünïcödé-Nämé-thät-ïs-löng 😀😀😀';
        const [frame] = encodeNotes({ room: ROOM, from: FROM, notes: [{ type: 'name', name }] });
        const read = decodeNotes(frame).notes[0].name;
        expect(new TextEncoder().encode(read).length).toBeLessThanOrEqual(NOTE_NAME_BYTES);
        expect(name.startsWith(read)).toBe(true);
        expect(cutUtf8('😀😀', 5)).toBe('😀');
    });

    it('leaves out notes that say nothing', () => {
        expect(encodeNotes({ room: ROOM, from: FROM, notes: [{ type: 'name', name: '' }, { type: 'rating', photo: 'a', rating: 9 }] })).toEqual([]);
    });

    it('goes through text for sound and back', () => {
        const [frame] = encodeNotes({ room: ROOM, from: FROM, notes: [{ type: 'name', name: 'Anna' }] });
        const text = notesText(frame);
        expect(text).toMatch(/^pg2:[A-Za-z0-9_-]+$/);
        expect(parseNotesText(text)).toEqual(frame);
        expect(parseNotesText('pg1:' + ROOM)).toBeNull();
        expect(parseNotesText('pg2:not base64!')).toBeNull();
    });

    it('reads nothing from bytes that are not a frame', () => {
        const [frame] = encodeNotes({ room: ROOM, from: FROM, notes: [{ type: 'rating', photo: 'a', rating: 3 }] });
        expect(decodeNotes(null)).toBeNull();
        expect(decodeNotes(frame.subarray(0, 8))).toBeNull();
        expect(decodeNotes(frame.subarray(0, frame.length - 1))).toBeNull();
        expect(decodeNotes(Uint8Array.from([...frame, 77]))).toBeNull();
        const stars = Uint8Array.from(frame);
        stars[stars.length - 1] = 9;
        expect(decodeNotes(stars)).toBeNull();
    });

    it('marks a person by the end of the peer id, where peer ids differ', () => {
        expect(peerMark('2d5757303330302d000000000000000000000001')).not.toBe(peerMark('2d5757303330302d000000000000000000000002'));
        expect(roomTag(ROOM)).not.toBe(roomTag(ROOM + 'x'));
    });
});
