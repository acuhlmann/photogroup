import { HEADER } from './lightFrames';
import { framesNeeded } from './fountain.js';

// How dense and how fast the codes are. A larger code needs a sharper
// camera; more codes each second need a faster one.
//
// The slow level is the one a transfer starts at. The normal level's codes
// carry 900 bytes each: at that density a handheld phone camera loses most
// of them to motion blur, autofocus hunting and glare, however still the
// person tries to hold it, so a transfer crept to a few percent and then
// seemed to stop. 420 bytes at 8 a second is a much coarser code that a
// moving camera can still read; the faster levels stay there for a phone
// on a stand or a big, bright screen.
export const LIGHT_LEVELS = [
    { id: 'sure', label: 'Slow and sure', frameBytes: 420, fps: 8 },
    { id: 'normal', label: 'Normal', frameBytes: 900, fps: 12 },
    { id: 'fast', label: 'Fast', frameBytes: 1800, fps: 20 },
];
export const DEFAULT_LEVEL = 'sure';

/** The file bytes each second at a level, when no code is lost. */
export function levelRate(level) {
    return (level.frameBytes - HEADER) * level.fps;
}

/** About how long a file takes when the camera reads all codes, as text. */
export function sendTimeText(bytes, level) {
    const seconds = framesNeeded(Math.ceil(bytes / (level.frameBytes - HEADER))) / level.fps;
    if (seconds < 90) return `about ${Math.max(5, Math.ceil(seconds / 5) * 5)} seconds`;
    return `about ${Math.round(seconds / 60)} minutes`;
}
