// On/off choices for this browser only, kept in localStorage. All are off
// until the person turns them on.

export const PREFERENCES = {
    removeLocation: 'photogroup.removeLocation',
    dataSaver: 'photogroup.dataSaver',
    notify: 'photogroup.notify',
};

export function readPreference(name) {
    try {
        return localStorage.getItem(PREFERENCES[name]) === 'true';
    } catch {
        return false;
    }
}

export function savePreference(name, value) {
    try {
        localStorage.setItem(PREFERENCES[name], String(!!value));
    } catch {
        // Storage blocked: the choice lasts until the page reloads.
    }
}
