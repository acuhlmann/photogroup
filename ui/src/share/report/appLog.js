// The app's log lines (js-logger, through the Settings log handler) and the
// errors the page did not catch, kept for a problem report. Only the newest
// lines stay, so a long session does not fill the memory.

export const MAX_LINES = 1500;
const MAX_TEXT = 2000;
const lines = [];

export function recordLog(level, text, at = Date.now()) {
    lines.push({ at, level: String(level || 'INFO'), text: String(text ?? '').slice(0, MAX_TEXT) });
    if (lines.length > MAX_LINES) lines.splice(0, lines.length - MAX_LINES);
}

export function readLog() {
    return lines.slice();
}

export function clearLog() {
    lines.length = 0;
}

let watching = false;

/** Errors that reach the window go into the log too. */
export function watchErrors(win = typeof window !== 'undefined' ? window : null) {
    if (watching || !win?.addEventListener) return;
    watching = true;
    win.addEventListener('error', event => {
        const where = event.filename ? ` (${event.filename}:${event.lineno})` : '';
        recordLog('ERROR', 'Uncaught: ' + (event.message || event.error) + where);
    });
    win.addEventListener('unhandledrejection', event => {
        const reason = event.reason;
        recordLog('ERROR', 'Unhandled rejection: ' + (reason?.stack || reason?.message || reason));
    });
}
