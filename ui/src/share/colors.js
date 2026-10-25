// Light or dark colors: the device's choice unless the person picks one.
// Kept in localStorage for this browser only.

const KEY = 'photogroup.colors';
const CHANGE = 'photogroup-colors';
export const COLORS = ['device', 'light', 'dark'];

export function readColors() {
    try {
        const value = localStorage.getItem(KEY);
        return COLORS.includes(value) ? value : 'device';
    } catch {
        return 'device';
    }
}

export function saveColors(value, win = window) {
    try {
        localStorage.setItem(KEY, value);
    } catch {
        // Storage blocked: the pick lasts until the page reloads.
    }
    win.dispatchEvent(new CustomEvent(CHANGE, { detail: value }));
}

/** Calls back with each new pick, and returns a function that stops it. */
export function onColorsChange(callback, win = window) {
    const handle = event => callback(event.detail);
    win.addEventListener(CHANGE, handle);
    return () => win.removeEventListener(CHANGE, handle);
}

export function isDark(colors, deviceIsDark) {
    return colors === 'dark' || (colors === 'device' && deviceIsDark);
}
