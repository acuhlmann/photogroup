import { tileFacts } from '../arrangeTiles';

// Ways to put a location back on a photo whose location was removed before
// it reached the room (Android blanks GPS, but the date taken stays).

const MINUTE = 60 * 1000;
const key = tile => tile.infoHash || tile.tileKey;
export const NEARBY_MINUTES = 120;
export const RECENT_MINUTES = 30;

/**
 * Other photos in the room with a location, taken close in time to this
 * one, nearest first: [{ fileName, minutes, location }].
 */
export function nearbyLocations(tile, tiles, master, { limit = 3, withinMinutes = NEARBY_MINUTES } = {}) {
    const takenAt = tileFacts(tile, master).takenAt;
    if (takenAt == null || !Array.isArray(tiles)) return [];
    return tiles
        .filter(other => other && other !== tile && !(key(tile) && key(other) === key(tile)))
        .map(other => ({ other, facts: tileFacts(other, master) }))
        .filter(({ facts }) => facts.location && facts.takenAt != null)
        .map(({ other, facts }) => ({
            fileName: other.fileName || 'another photo',
            minutes: Math.round(Math.abs(facts.takenAt - takenAt) / MINUTE),
            location: facts.location,
        }))
        .filter(item => item.minutes <= withinMinutes)
        .sort((a, b) => a.minutes - b.minutes)
        .slice(0, limit);
}

/** Minutes since this photo was taken, when that is less than half an hour; else null. */
export function takenMinutesAgo(tile, master, now = Date.now()) {
    const takenAt = tileFacts(tile, master).takenAt;
    if (takenAt == null) return null;
    const minutes = Math.round((now - takenAt) / MINUTE);
    return minutes >= 0 && minutes < RECENT_MINUTES ? minutes : null;
}

/** "4 minutes", "1 minute", "2 hours". */
export function minutesText(minutes) {
    if (minutes < 90) return minutes === 1 ? '1 minute' : `${minutes} minutes`;
    return `${Math.round(minutes / 60)} hours`;
}
