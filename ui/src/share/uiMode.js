// Three ways to show the app. Simple is for strangers swapping photos on the
// spot, default is the full gallery, geek puts the network first.
export const MODES = ['simple', 'default', 'geek'];

export const MODE_INFO = {
    simple: { label: 'Simple', detail: 'Just share and get photos' },
    default: { label: 'Default', detail: 'Gallery, details, sorting and maps' },
    geek: { label: 'Geek', detail: 'Live network map, photos on the devices' },
};

const KEY = 'photogroup.uiMode';
// A build can start new people elsewhere; the end-to-end tests use default.
const START = MODES.includes(import.meta.env?.VITE_START_MODE) ? import.meta.env.VITE_START_MODE : 'simple';
// Set by RoomsService on first visit, so its presence means "been here before".
const RETURNING = 'clientId';

/**
 * The mode to start in: the one picked last, else simple for someone new.
 * People who used PhotoGroup before modes existed keep the view they know.
 * Read this before RoomsService runs, since it is what marks a visit.
 */
export function readMode() {
    try {
        const stored = localStorage.getItem(KEY);
        if (MODES.includes(stored)) return stored;
        return localStorage.getItem(RETURNING) ? 'default' : START;
    } catch {
        return START;
    }
}

export function saveMode(mode) {
    if (!MODES.includes(mode)) return;
    try {
        localStorage.setItem(KEY, mode);
    } catch {
        // Keep it for this visit anyway.
    }
}
