import { flightMs } from './timeline';

// Plays the tour's steps into a timeline the map draws from: each step's
// packets leave at their moment, the step loops until you move on (or moves
// on by itself when playing), and holding it freezes every dot in place.

export const SPEEDS = [0.5, 1, 2];
// A step's packets replay after this pause, so a held-open step keeps moving.
const LOOP_GAP_MS = 900;

/**
 * @param {object} deps
 * @param {object} deps.timeline createTimeline(): what the map draws
 * @param {() => number} [deps.now]
 */
export function createTourPlayer({ timeline, now = () => Date.now() }) {
    let steps = [];
    let index = 0;
    let elapsed = 0;
    let sent = new Set();
    let last = null;
    let auto = false;
    let held = false;
    let speed = 1;
    const listeners = new Set();
    const emit = () => listeners.forEach(fn => fn());

    const step = () => steps[index] || null;

    const restart = () => {
        elapsed = 0;
        sent = new Set();
        last = now();
    };

    const go = to => {
        if (!steps.length) return;
        index = Math.max(0, Math.min(steps.length - 1, to));
        timeline.clear();
        restart();
        emit();
    };

    /** Send whatever is due, and move on or loop at the end of a step. */
    const tick = () => {
        const current = step();
        if (!current) return;
        const at = now();
        if (last === null) last = at;
        const delta = (at - last) * speed;
        last = at;
        // Held: nothing leaves, and the step does not run on underneath.
        if (held) return;
        elapsed += delta;
        (current.packets || []).forEach((packet, number) => {
            if (sent.has(number) || packet.at > elapsed) return;
            sent.add(number);
            timeline.push({
                kind: 'tour',
                flights: [{
                    routeId: packet.route,
                    reverse: !!packet.reverse,
                    label: packet.label || '',
                    rgb: packet.rgb,
                    dur: flightMs(packet.speed || 0.012) / speed,
                }],
            });
        });
        const end = (current.duration || 4000) + LOOP_GAP_MS;
        if (elapsed < end) return;
        if (auto && index < steps.length - 1) go(index + 1);
        else if (auto) {
            auto = false;
            restart();
            emit();
        } else restart();
    };

    return {
        load(next) {
            const id = step()?.id;
            steps = next || [];
            // A rebuilt scene keeps you on the step you were reading.
            const keep = steps.findIndex(item => item.id === id);
            index = keep >= 0 ? keep : Math.min(index, Math.max(0, steps.length - 1));
            emit();
        },
        start(at = 0) {
            held = false;
            if (timeline.playing === false) timeline.resume();
            go(at);
        },
        tick,
        next() { go(index + 1); },
        prev() { go(index - 1); },
        goto: go,
        /** Run through the steps on its own. */
        setAuto(value) {
            auto = !!value;
            held = false;
            timeline.resume();
            emit();
        },
        /** Freeze every packet where it is, to read the labels. */
        setHeld(value) {
            held = !!value;
            if (held) timeline.pause();
            else {
                last = now();
                timeline.resume();
            }
            emit();
        },
        setSpeed(value) {
            speed = SPEEDS.includes(value) ? value : 1;
            emit();
        },
        subscribe(fn) {
            listeners.add(fn);
            return () => listeners.delete(fn);
        },
        get step() { return step(); },
        get index() { return index; },
        get count() { return steps.length; },
        get auto() { return auto; },
        get held() { return held; },
        get speed() { return speed; },
        /** 0..1 through the current step, for a progress bar. */
        get progress() {
            const current = step();
            return current ? Math.min(1, elapsed / (current.duration || 4000)) : 0;
        },
    };
}
