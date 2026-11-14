import { HEADER } from './lightFrames';
import { framesNeeded } from './fountain.js';

// How dense and how fast the codes are. A larger code needs a sharper
// camera; more codes each second need a faster one.
export const LIGHT_LEVELS = [
    { id: 'sure', label: 'Slow and sure', frameBytes: 420, fps: 8 },
    { id: 'normal', label: 'Normal', frameBytes: 900, fps: 12 },
    { id: 'fast', label: 'Fast', frameBytes: 1800, fps: 20 },
];
export const DEFAULT_LEVEL = 'normal';

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
