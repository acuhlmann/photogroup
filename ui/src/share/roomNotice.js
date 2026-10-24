// A note for the next page load, e.g. that the room was deleted: leaving a
// room reloads the page, so a snackbar shown before it would be lost.
const KEY = 'photogroup.notice';

export function leaveRoomNotice(text) {
    try {
        sessionStorage.setItem(KEY, text);
    } catch { /* storage blocked */ }
}

/** The note left for this page load, once; null when there is none. */
export function takeRoomNotice() {
    try {
        const text = sessionStorage.getItem(KEY);
        sessionStorage.removeItem(KEY);
        return text;
    } catch {
        return null;
    }
}
