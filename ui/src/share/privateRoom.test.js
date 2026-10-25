import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import {
    isPrivateRoom, keyForNewRoom, keyHash, markPrivate, missingRoomKey, restoreRoomKey, roomKeyText, setKeyInAddress,
} from './privateRoom';
import { visitRoom } from './recentRooms';

const KEY = 'a'.repeat(43);

function memoryStorage() {
    const items = new Map();
    return {
        getItem: key => (items.has(key) ? items.get(key) : null),
        setItem: (key, value) => items.set(key, String(value)),
        removeItem: key => items.delete(key),
    };
}

describe('privateRoom', () => {
    beforeEach(() => {
        vi.stubGlobal('localStorage', memoryStorage());
        window.history.replaceState({}, '', '/?room=r1');
        markPrivate(false);
    });
    afterEach(() => window.history.replaceState({}, '', '/'));

    it('puts the key in the address, after the room', () => {
        setKeyInAddress(KEY);
        expect(window.location.search).toBe('?room=r1');
        expect(window.location.hash).toBe('#k=' + KEY);
        expect(roomKeyText()).toBe(KEY);
        expect(keyHash(null)).toBe('');
    });

    it('knows a private room that this page has no key for', () => {
        expect(isPrivateRoom()).toBe(false);
        markPrivate(true);
        expect(isPrivateRoom()).toBe(true);
        expect(missingRoomKey()).toBe(true);
        setKeyInAddress(KEY);
        expect(missingRoomKey()).toBe(false);
    });

    it('adds the key this browser kept when the room opens without it', () => {
        visitRoom('r1', 1000, KEY);
        restoreRoomKey();
        expect(roomKeyText()).toBe(KEY);
    });

    it('makes a key for a new room only when the switch is on', () => {
        expect(keyForNewRoom()).toBeNull();
        localStorage.setItem('encrypt', 'true');
        expect(keyForNewRoom()).toMatch(/^[A-Za-z0-9_-]{43}$/);
    });
});
