import { describe, it, expect } from 'vitest';
import { roomCodeText, parseRoomCode } from './roomCode';

const KEY = 'A'.repeat(43);

describe('roomCode', () => {
    it('carries a room id there and back', () => {
        const text = roomCodeText({ room: 'z45keexwrxqzbeqimgsz' });
        expect(text).toBe('pg1:z45keexwrxqzbeqimgsz');
        expect(parseRoomCode(text)).toEqual({ room: 'z45keexwrxqzbeqimgsz', key: null });
    });

    it('carries a private room key', () => {
        const text = roomCodeText({ room: 'z45keexwrxqzbeqimgsz', key: KEY });
        expect(parseRoomCode(text)).toEqual({ room: 'z45keexwrxqzbeqimgsz', key: KEY });
    });

    it('does not send an id that is not a room id', () => {
        expect(roomCodeText({ room: 'a b' })).toBeNull();
        expect(roomCodeText({})).toBeNull();
    });

    it('ignores sound from other apps and damaged codes', () => {
        expect(parseRoomCode('hello')).toBeNull();
        expect(parseRoomCode('pg1:')).toBeNull();
        expect(parseRoomCode('pg1:room<script>')).toBeNull();
        expect(parseRoomCode('pg1:z45keexwrxqzbeqimgsz#short')).toBeNull();
        expect(parseRoomCode('pg1:z45keexwrxqzbeqimgsz#' + KEY + '#x')).toBeNull();
    });
});
