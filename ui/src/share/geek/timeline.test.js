import { describe, it, expect, vi } from 'vitest';
import { createTimeline } from './timeline';

/** A timeline whose clock the test drives. */
const make = (start = 0) => {
    const clock = { value: start };
    const timeline = createTimeline({ now: () => clock.value });
    return { timeline, clock };
};

const flight = (at, dur = 1000) => ({ at, kind: 'rx', flights: [{ routeId: 'sse:me', dur }] });

describe('timeline', () => {
    it('follows the live edge until it is paused', () => {
        const { timeline, clock } = make(1000);
        expect(timeline.playing).toBe(true);
        clock.value = 2000;
        expect(timeline.clock()).toBe(2000);

        timeline.pause();
        expect(timeline.playing).toBe(false);
        expect(timeline.clock()).toBe(2000);
        clock.value = 9000;
        // A paused view holds its moment; that is what makes a label readable.
        expect(timeline.clock()).toBe(2000);
        timeline.resume();
        expect(timeline.clock()).toBe(9000);
    });

    it('counts the events a room sent while the view was pinned', () => {
        const { timeline, clock } = make(1000);
        timeline.pause();
        clock.value = 5000;
        timeline.push(flight(5000));
        timeline.push(flight(5200));
        expect(timeline.missed()).toBe(2);
        timeline.resume();
        expect(timeline.missed()).toBe(0);
    });

    it('places a packet along its route by the clock, so scrubbing back redraws it', () => {
        const { timeline } = make(0);
        timeline.push({ at: 1000, kind: 'rx', flights: [{ routeId: 'p2p:a|b', dur: 1000, label: '#3/40' }] });

        expect(timeline.inFlight(500)).toEqual([]);
        const half = timeline.inFlight(1500);
        expect(half).toHaveLength(1);
        expect(half[0].progress).toBeCloseTo(0.5);
        expect(half[0].label).toBe('#3/40');
        expect(timeline.inFlight(2000)[0].progress).toBeCloseTo(1);
        expect(timeline.inFlight(2001)).toEqual([]);
    });

    it('lands a longer flight over its whole crossing, not a default one', () => {
        const { timeline } = make(0);
        timeline.push({ at: 1000, kind: 'tx', flights: [{ routeId: 'lan:a|b', dur: 4000 }] });
        expect(timeline.inFlight(4900)).toHaveLength(1);
        expect(timeline.inFlight(5001)).toEqual([]);
    });

    it('steps to the previous and next event, parking mid-flight', () => {
        const { timeline } = make(3000);
        timeline.push(flight(1000));
        timeline.push(flight(2000));

        // Forward from the live edge has nowhere newer to go.
        timeline.step(1);
        expect(timeline.playing).toBe(true);

        // Back from the live edge lands on the newest event, mid-crossing.
        timeline.step(-1);
        expect(timeline.clock()).toBe(2500);
        timeline.step(-1);
        expect(timeline.clock()).toBe(1500);
        // Nothing older than the first event: the playhead stays put.
        timeline.step(-1);
        expect(timeline.clock()).toBe(1500);

        timeline.step(1);
        expect(timeline.clock()).toBe(2500);
        timeline.step(1);
        // Stepped past the newest event, so it goes live again.
        expect(timeline.playing).toBe(true);
    });

    it('names the event the playhead is parked on', () => {
        const { timeline, clock } = make(3000);
        const first = timeline.push({ ...flight(1000), kind: 'rx', text: 'piece 1' });
        const second = timeline.push({ ...flight(2000), kind: 'rx', text: 'piece 2' });

        expect(timeline.shown()).toBeNull();
        // The second event finishes crossing exactly at 3000, so it is the one on screen.
        timeline.pause();
        expect(timeline.shown().id).toBe(second.id);
        timeline.step(-1);
        expect(timeline.shown().id).toBe(first.id);
        // Scrubbing past every flight parks on nothing.
        clock.value = 6000;
        timeline.seek(6000);
        expect(timeline.shown()).toBeNull();
    });

    it('keeps a bounded window of history, oldest first', () => {
        const clock = { value: 0 };
        const timeline = createTimeline({ now: () => clock.value, history: 1000, limit: 3 });
        for (let index = 0; index < 10; index++) {
            clock.value = index * 100;
            timeline.push(flight(index * 100));
        }
        expect(timeline.entries.map(entry => entry.at)).toEqual([700, 800, 900]);
        expect(timeline.floor).toBe(700);
        expect(timeline.head).toBe(900);
    });

    it('drops entries past the count limit even inside the window', () => {
        const clock = { value: 0 };
        const timeline = createTimeline({ now: () => clock.value, history: 100000, limit: 2 });
        timeline.push(flight(0));
        timeline.push(flight(10));
        timeline.push(flight(20));
        expect(timeline.entries.map(entry => entry.at)).toEqual([10, 20]);
    });

    it('lists only events with a log line, newest first', () => {
        const { timeline } = make(0);
        timeline.push({ at: 1, kind: 'peer', text: '+ Ana joined', flights: [] });
        timeline.push({ at: 2, kind: 'rx', text: '', flights: [{ routeId: 'p2p:a|b', dur: 500 }] });
        timeline.push({ at: 3, kind: 'photo', text: '+ beach.jpg', flights: [] });

        const lines = timeline.recent();
        expect(lines.map(line => line.text)).toEqual(['+ beach.jpg', '+ Ana joined']);
        expect(lines[0].id).toBe(3);
        expect(timeline.find(2).flights).toHaveLength(1);
    });

    it('seeks to a moment and back to the live edge', () => {
        const { timeline, clock } = make(5000);
        timeline.seek(1234);
        expect(timeline.clock()).toBe(1234);
        // A future time clamps to now: nothing to show that has not happened.
        clock.value = 6000;
        timeline.seek(99999);
        expect(timeline.clock()).toBe(6000);
        timeline.seek(null);
        expect(timeline.playing).toBe(true);
    });

    it('tells listeners when the recording or the playhead moves', () => {
        const { timeline } = make(0);
        const seen = vi.fn();
        const stop = timeline.subscribe(seen);
        timeline.push(flight(0));
        timeline.pause();
        expect(seen).toHaveBeenCalledTimes(2);
        stop();
        timeline.resume();
        expect(seen).toHaveBeenCalledTimes(2);
    });

    it('spans from the window floor to now for the scrubber', () => {
        const clock = { value: 0 };
        const timeline = createTimeline({ now: () => clock.value, history: 1000 });
        clock.value = 5000;
        expect(timeline.bounds).toEqual({ from: 4000, to: 5000 });
        timeline.push(flight(4600));
        expect(timeline.bounds).toEqual({ from: 4000, to: 5000 });
    });
});
