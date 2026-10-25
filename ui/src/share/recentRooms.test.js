import { describe, it, expect, beforeEach, vi } from 'vitest';
import { findRoom, forgetRoom, listRooms, nameRoom, roomLabel, visitRoom } from './recentRooms';

/** A working localStorage; the shared test setup stubs one that stores nothing. */
function memoryStorage() {
    const items = new Map();
    return {
        getItem: key => (items.has(key) ? items.get(key) : null),
        setItem: (key, value) => items.set(key, String(value)),
        removeItem: key => items.delete(key),
    };
}

describe('recentRooms', () => {
    beforeEach(() => vi.stubGlobal('localStorage', memoryStorage()));

    it('lists the rooms opened last first, once each', () => {
        visitRoom('a', 1000);
        visitRoom('b', 2000);
        visitRoom('a', 3000);
        expect(listRooms().map(room => room.id)).toEqual(['a', 'b']);
        expect(findRoom('a')).toMatchObject({ firstSeen: 1000, lastSeen: 3000 });
    });

    it('keeps the name the room has, even before the visit is noted', () => {
        nameRoom('a', 'Beach day', 1000);
        visitRoom('a', 2000);
        expect(findRoom('a')).toMatchObject({ name: 'Beach day', firstSeen: 1000, lastSeen: 2000 });
        nameRoom('a', '');
        expect(findRoom('a').name).toBeUndefined();
    });

    it('forgets a room', () => {
        visitRoom('a');
        visitRoom('b');
        forgetRoom('a');
        expect(listRooms().map(room => room.id)).toEqual(['b']);
    });

    it('calls a room by its name, else by the day it was first opened', () => {
        expect(roomLabel({ name: 'Beach day' })).toBe('Beach day');
        expect(roomLabel({ firstSeen: new Date(2026, 9, 25).getTime() })).toBe('Room from 25 Oct');
        expect(roomLabel(null)).toBe('This room');
    });

    it('starts empty when the stored list is broken', () => {
        localStorage.setItem('photogroup.rooms', '{nope');
        expect(listRooms()).toEqual([]);
    });
});
