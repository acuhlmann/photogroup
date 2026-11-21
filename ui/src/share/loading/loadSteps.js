/**
 * What the page does while it opens, step by step, with real times. The
 * page in index.html shows the first step (load the app) before any of the
 * app's code runs; this carries on from there, so the steps a person sees
 * do not start again when the app takes over.
 *
 * Steps: app → server → room. Each one waits, runs, is done, or failed.
 * Geek mode also shows `lines`: one line per real event (a file, a request,
 * the tracker, a connection), timed from the start of the page.
 */

export const STEPS = ['app', 'server', 'room'];

/** What each step is called. Simple mode says "phone", the others "device". */
export const STEP_LABELS = {
    app: 'Load the app',
    server: 'Connect to the server',
    room: 'Join the room',
};

/** After this, a step that still runs gets a note that it is slow. */
export const SLOW_MS = 4000;

const MAX_LINES = 120;

const now = () => (typeof performance !== 'undefined' && performance.now ? performance.now() : Date.now());

/** "452 kB", "5.1 kB", "800 B". */
export function formatBytes(bytes) {
    if (!Number.isFinite(bytes) || bytes <= 0) return '';
    if (bytes < 1000) return `${Math.round(bytes)} B`;
    if (bytes < 100000) return `${(bytes / 1000).toFixed(1)} kB`;
    if (bytes < 1000000) return `${Math.round(bytes / 1000)} kB`;
    return `${(bytes / 1000000).toFixed(1)} MB`;
}

/** "180 ms", "2.3 s". */
export function formatMs(ms) {
    if (!Number.isFinite(ms) || ms < 0) return '';
    if (ms < 1000) return `${Math.round(ms)} ms`;
    return `${(ms / 1000).toFixed(1)} s`;
}

/** The last part of a URL's path: "index-a17L9s-V.js", "__rtcConfig__". */
function shortName(url) {
    try {
        const { pathname } = new URL(url, 'http://x');
        return pathname.split('/').filter(Boolean).pop() || '/';
    } catch {
        return String(url);
    }
}

/**
 * Lines for what the browser did before the app ran: the page itself, the
 * app's files and the requests that index.html starts early. From the
 * browser's own timing, so they are real.
 */
export function bootLines(perf = typeof performance !== 'undefined' ? performance : null) {
    if (!perf || typeof perf.getEntriesByType !== 'function') return [];
    const lines = [];
    const nav = perf.getEntriesByType('navigation')[0];
    if (nav) {
        const size = formatBytes(nav.transferSize || nav.encodedBodySize);
        const cached = nav.transferSize === 0 && nav.decodedBodySize > 0;
        lines.push({
            at: nav.responseEnd,
            kind: 'page',
            text: `GET ${location.pathname || '/'}${cached ? ' · from the cache' : ''}${size ? ' · ' + size : ''} · first byte ${formatMs(nav.responseStart - nav.startTime)}`,
        });
    }
    perf.getEntriesByType('resource')
        .filter(entry => /\/assets\/.+\.(js|css)$/.test(entry.name) || /\/api\/__(rtc|tracker)Config__/.test(entry.name))
        .forEach(entry => {
            const api = entry.name.includes('/api/');
            const cached = !api && entry.transferSize === 0 && entry.decodedBodySize > 0;
            const size = formatBytes(entry.transferSize || entry.encodedBodySize);
            lines.push({
                at: entry.responseEnd,
                kind: api ? 'api' : 'file',
                text: api
                    ? `GET /api/${shortName(entry.name)} · ${formatMs(entry.duration)}`
                    : `${shortName(entry.name)} · ${cached ? 'from the cache' : size || 'kept'} · ${formatMs(entry.duration)}`,
            });
        });
    return lines.sort((a, b) => a.at - b.at);
}

/** How much of the app came over the network: "508 kB", or "from the cache". */
export function appDetail(perf = typeof performance !== 'undefined' ? performance : null) {
    if (!perf || typeof perf.getEntriesByType !== 'function') return undefined;
    const files = perf.getEntriesByType('resource').filter(entry => /\/assets\/.+\.(js|css)$/.test(entry.name));
    if (!files.length) return undefined;
    const bytes = files.reduce((sum, entry) => sum + (entry.transferSize || 0), 0);
    return bytes > 0 ? formatBytes(bytes) : 'from the cache';
}

export default class LoadSteps {

    /**
     * @param {{emit: Function}} emitter the app's emitter; gets 'loadSteps'
     * @param {{clock?: () => number, perf?: object}} [options]
     */
    constructor(emitter, { clock = now, perf } = {}) {
        this.emitter = emitter;
        this.clock = clock;
        this.steps = {};
        STEPS.forEach(id => { this.steps[id] = { id, state: 'wait' }; });
        this.lines = bootLines(perf);
        // The page and its files are here: the first step is done.
        this.steps.app = { id: 'app', state: 'done', startedAt: 0, endedAt: this.clock() };
        this.steps.app.detail = appDetail(perf);
    }

    emit() {
        if (this.emitter) this.emitter.emit('loadSteps', this.snapshot());
    }

    /** A copy for React: new objects, so a change redraws. */
    snapshot() {
        return {
            steps: STEPS.map(id => ({ ...this.steps[id] })),
            lines: this.lines.slice(),
        };
    }

    start(id, detail) {
        const step = this.steps[id];
        if (!step || step.state === 'run') return;
        this.steps[id] = { id, state: 'run', startedAt: this.clock(), detail };
        this.emit();
    }

    /** Whether a step runs now. */
    running(id) {
        return this.steps[id]?.state === 'run';
    }

    /** A step that runs is done. A step that does not run stays as it is. */
    done(id, detail) {
        const step = this.steps[id];
        if (!step || step.state !== 'run') return;
        const at = this.clock();
        this.steps[id] = {
            ...step,
            state: 'done',
            endedAt: at,
            detail: detail ?? step.detail,
        };
        this.emit();
    }

    fail(id, detail) {
        const step = this.steps[id];
        if (!step || step.state !== 'run') return;
        const at = this.clock();
        this.steps[id] = { ...step, state: 'fail', endedAt: at, detail };
        this.emit();
    }

    /** One line for geek mode. */
    log(kind, text) {
        this.lines.push({ at: this.clock(), kind, text });
        if (this.lines.length > MAX_LINES) this.lines.splice(0, this.lines.length - MAX_LINES);
        this.emit();
    }

    /** Lines for the early requests to the server that the browser has timed by now. */
    logConfigRequests(perf = typeof performance !== 'undefined' ? performance : null) {
        if (!perf || typeof perf.getEntriesByType !== 'function') return;
        const seen = new Set(this.lines.map(line => line.text));
        bootLines(perf)
            .filter(line => line.kind === 'api' && !seen.has(line.text))
            .forEach(line => this.lines.push(line));
        this.lines.sort((a, b) => a.at - b.at);
        this.emit();
    }
}
