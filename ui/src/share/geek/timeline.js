// One clock for geek mode. Every event worth drawing is recorded here once,
// with the log line it produced and the routes it flew, so the map and the
// footer read the same history. Pausing, scrubbing and clicking a log line are
// then the same thing: moving the playhead.

// A packet takes this long to cross its route when the caller gives no speed.
export const FLIGHT_MS = 1400;
// Traffic kept for scrubbing back.
export const HISTORY_MS = 120000;
export const MAX_ENTRIES = 400;
// Transfer progress fires many times a second; one log line per key this often.
export const SAME_TEXT_MS = 1500;

// Frame-based speeds in the old animation loop became durations; this is the
// one place that converts, so a caller can still say "fast" or "slow".
const FRAME_MS = 1000 / 60;

/** One crossing of a route at this per-frame speed, in milliseconds. */
export const flightMs = speed => FRAME_MS / (speed || 0.012);

const nowMs = () => Date.now();

/**
 * A recording of the room's traffic with a playhead.
 * `now` is injectable so tests can move time.
 */
export function createTimeline({ now = nowMs, history = HISTORY_MS, limit = MAX_ENTRIES } = {}) {
    let entries = [];
    let seq = 0;
    // null follows the live edge; a time pins the view there.
    let playhead = null;
    // The event the playhead is parked on, so stepping carries on from it.
    let anchorId = null;
    const listeners = new Set();
    // Only the playhead: a paused map says so, and that is the one thing the
    // drawing has to react to. New traffic must not re-render it for this.
    const clockListeners = new Set();

    const emit = () => listeners.forEach(fn => fn());
    const emitClock = () => {
        listeners.forEach(fn => fn());
        clockListeners.forEach(fn => fn());
    };

    /** Anything older than the window is gone; the playhead never protects entries. */
    const prune = () => {
        const floor = now() - history;
        while (entries.length && entries[0].at < floor) entries.shift();
        if (entries.length > limit) entries.splice(0, entries.length - limit);
    };

    const newest = () => (entries.length ? entries[entries.length - 1] : null);
    const oldest = () => (entries.length ? entries[0] : null);

    /** The event crossing under this moment, if the playhead is on one. */
    const entryAt = time => entries.find(
        entry => entry.flights.length && time >= entry.at && time <= entry.at + entry.span
    ) || null;

    // When each key last earned a log line.
    const lastText = new Map();

    /**
     * Record one app event. `text` is its log line ('' for events only worth
     * a dot on the map); `flights` are the routes it travelled. A repeated
     * `key` only writes a line this often, so a busy route stays readable
     * while every one of its packets still flies.
     */
    const push = ({ kind, text = '', key = '', flights = [], route, count, speed, at = now() }) => {
        // A key never written is not throttled; `|| 0` would eat the first line.
        if (text && key && at - (lastText.get(key) ?? -Infinity) < SAME_TEXT_MS) text = '';
        if (text && key) lastText.set(key, at);
        const entry = {
            id: ++seq,
            at,
            kind,
            text,
            // What a route's label counts and quotes at this moment: pieces
            // moved on `route`, and the speed last reported for it.
            route,
            count,
            speed,
            flights: flights.filter(Boolean).map(flight => ({
                routeId: flight.routeId,
                rgb: flight.rgb,
                label: flight.label || '',
                reverse: !!flight.reverse,
                dur: flight.dur || FLIGHT_MS,
            })),
        };
        // The longest flight decides when this event is finished crossing, and
        // the moment in its middle where a step parks the playhead. An event
        // with no packet (a peer joining, say) still needs a span to be found by.
        entry.span = entry.flights.reduce((max, item) => Math.max(max, item.dur), 0) || FLIGHT_MS;
        entry.mid = entry.at + entry.span / 2;
        entries.push(entry);
        prune();
        emit();
        return entry;
    };

    /** Where the view is: the live edge, or the pinned moment. */
    const clock = () => (playhead === null ? now() : playhead);

    const pause = () => {
        if (playhead === null) {
            playhead = now();
            // Whatever is mid-crossing right now is what the screen already
            // shows, so the first step back means the event before it.
            anchorId = entryAt(playhead)?.id ?? null;
            emitClock();
        }
        return playhead;
    };

    const resume = () => {
        if (playhead !== null) {
            playhead = null;
            anchorId = null;
            emitClock();
        }
    };

    /** Pin the view to a moment, or pass null to follow the live edge again. */
    const seek = time => {
        if (time === null || time === undefined) {
            playhead = null;
            anchorId = null;
        } else {
            playhead = Math.min(time, now());
            // Remember which event that moment belongs to, so the next step
            // carries on from it instead of jumping back to the live edge.
            anchorId = entryAt(playhead)?.id ?? null;
        }
        emitClock();
        return playhead;
    };

    /**
     * Move to the previous (-1) or next (+1) event and show it mid-crossing.
     * Stepping goes by event, not by clock: several pieces can share a
     * millisecond, and a packet that left a moment ago is only readable
     * half-way across. Stepping past the newest event returns to the live edge.
     */
    const step = direction => {
        if (!entries.length) return playhead;
        if (direction > 0) {
            // Nothing newer than the live edge to step on to.
            if (anchorId === null) return playhead;
            const index = entries.findIndex(entry => entry.id === anchorId);
            const next = entries[index + 1];
            if (next) {
                anchorId = next.id;
                playhead = next.mid;
            } else {
                anchorId = null;
                playhead = null;
            }
        } else {
            const index = anchorId === null
                ? entries.length - 1
                : entries.findIndex(entry => entry.id === anchorId) - 1;
            const target = entries[Math.max(0, index)];
            anchorId = target.id;
            playhead = target.mid;
        }
        emitClock();
        return playhead;
    };

    /** The event the playhead is parked on, or null at the live edge. */
    const shown = () => {
        if (anchorId === null) return null;
        return entries.find(entry => entry.id === anchorId) || null;
    };

    /**
     * Park the view on one recorded event, mid-crossing. This is what a click
     * on a log line does: the footer names an event and the map shows it.
     */
    const focus = id => {
        const entry = entries.find(item => item.id === id);
        if (!entry) return playhead;
        anchorId = entry.id;
        playhead = entry.mid;
        emitClock();
        return playhead;
    };

    /**
     * The packets to draw at a moment: everything whose flight covers it.
     * Progress is `0..1` along the route, so the map can place a dot exactly
     * where it was then — including when scrubbing backwards.
     */
    const inFlight = (at = clock()) => {
        const drawn = [];
        for (let index = entries.length - 1; index >= 0; index--) {
            const entry = entries[index];
            if (entry.at + entry.span < at) break;
            if (entry.at > at || !entry.flights.length) continue;
            entry.flights.forEach(flight => {
                const progress = (at - entry.at) / flight.dur;
                if (progress >= 0 && progress <= 1) drawn.push({ ...flight, entryId: entry.id, kind: entry.kind, progress });
            });
        }
        return drawn;
    };

    /** Events the room sent while the view was pinned behind the live edge. */
    const missed = () => (playhead === null ? 0 : entries.filter(entry => entry.at > playhead).length);

    /** Log lines, newest first. Events without a line stay out of the list. */
    const recent = (count = limit) => entries.filter(entry => entry.text).slice(-count).reverse();

    const subscribe = fn => {
        listeners.add(fn);
        return () => listeners.delete(fn);
    };

    const subscribeClock = fn => {
        clockListeners.add(fn);
        return () => clockListeners.delete(fn);
    };

    return {
        push,
        subscribe,
        subscribeClock,
        get entries() { return entries; },
        recent,
        inFlight,
        clock,
        pause,
        resume,
        seek,
        step,
        shown,
        focus,
        missed,
        find: id => entries.find(entry => entry.id === id),
        get playing() { return playhead === null; },
        get head() { return newest() ? newest().at : null; },
        get floor() { return oldest() ? oldest().at : null; },
        /** Range the scrubber spans; one point when nothing is recorded. */
        get bounds() {
            const head = now();
            return { from: entries.length ? Math.min(oldest().at, head - history) : head - history, to: head };
        },
        clear() { entries = []; emit(); },
    };
}
