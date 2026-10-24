import { describe, it, expect } from 'vitest';
import { holdsRoomSnapshot } from '../TorrentDeletion';

describe('holdsRoomSnapshot', () => {
    it('reads a room that names photos as evidence about the ones it leaves out', () => {
        expect(holdsRoomSnapshot([{ infoHash: 'a' }, { infoHash: 'b' }])).toBe(true);
    });

    it('trusts nothing to an empty room', () => {
        // The room lives in memory: after a restart or an idle stop it comes
        // back listing no photos, which must not be read as "all deleted".
        expect(holdsRoomSnapshot([])).toBe(false);
    });

    it('trusts nothing to a snapshot that never arrived', () => {
        expect(holdsRoomSnapshot(undefined)).toBe(false);
        expect(holdsRoomSnapshot(null)).toBe(false);
        expect(holdsRoomSnapshot('a')).toBe(false);
    });
});
