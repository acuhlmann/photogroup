import { describe, it, expect } from 'vitest';
import { minutesText, nearbyLocations, takenMinutesAgo } from './locationHints';

const at = minutes => new Date(Date.UTC(2026, 9, 31, 10, minutes));
const photo = (fileName, minutes, location) => ({
    fileName, infoHash: fileName, isImage: true, picDateTakenDate: minutes == null ? undefined : at(minutes),
    details: location ? { location } : undefined,
});

describe('nearbyLocations', () => {
    const blank = photo('IMG_1.jpg', 30);
    const tiles = [
        blank,
        photo('far.jpg', 30 + 180, { lat: 1, long: 1 }),
        photo('IMG_2.jpg', 34, { lat: 47.37, long: 8.54 }),
        photo('IMG_0.jpg', 20, { lat: 47.36, long: 8.53 }),
        photo('no-place.jpg', 31),
        photo('no-date.jpg', null, { lat: 2, long: 2 }),
    ];

    it('lists photos with a location taken close in time, nearest first', () => {
        expect(nearbyLocations(blank, tiles, null)).toEqual([
            { fileName: 'IMG_2.jpg', minutes: 4, location: { lat: 47.37, long: 8.54 } },
            { fileName: 'IMG_0.jpg', minutes: 10, location: { lat: 47.36, long: 8.53 } },
        ]);
    });

    it('has nothing for a photo without a date taken', () => {
        expect(nearbyLocations(photo('x.jpg', null), tiles, null)).toEqual([]);
    });
});

describe('takenMinutesAgo', () => {
    it('counts only photos from the last half hour', () => {
        const now = at(60).getTime();
        expect(takenMinutesAgo(photo('a.jpg', 48), null, now)).toBe(12);
        expect(takenMinutesAgo(photo('b.jpg', 20), null, now)).toBeNull();
        expect(takenMinutesAgo(photo('c.jpg', null), null, now)).toBeNull();
    });
});

describe('minutesText', () => {
    it('says minutes, then hours', () => {
        expect(minutesText(1)).toBe('1 minute');
        expect(minutesText(4)).toBe('4 minutes');
        expect(minutesText(120)).toBe('2 hours');
    });
});
