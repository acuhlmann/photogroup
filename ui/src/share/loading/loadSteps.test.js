import { describe, it, expect, vi } from 'vitest';
import LoadSteps, { appDetail, bootLines, formatBytes, formatMs } from './loadSteps';

const perf = (entries = {}) => ({
    getEntriesByType: type => entries[type] || [],
});

describe('LoadSteps', () => {
    it('starts with the app loaded and the other steps waiting', () => {
        const steps = new LoadSteps(null, { clock: () => 1500, perf: perf() });
        const { steps: list } = steps.snapshot();
        expect(list.map(step => [step.id, step.state])).toEqual([['app', 'done'], ['server', 'wait'], ['room', 'wait']]);
        expect(list[0].endedAt).toBe(1500);
    });

    it('runs a step, then is done with it, and says so each time', () => {
        let now = 100;
        const emitter = { emit: vi.fn() };
        const steps = new LoadSteps(emitter, { clock: () => now, perf: perf() });
        steps.start('server');
        expect(steps.running('server')).toBe(true);
        now = 400;
        steps.done('server');
        const server = steps.snapshot().steps[1];
        expect(server).toMatchObject({ state: 'done', startedAt: 100, endedAt: 400 });
        expect(emitter.emit).toHaveBeenCalledTimes(2);
        expect(emitter.emit).toHaveBeenLastCalledWith('loadSteps', expect.objectContaining({ steps: expect.any(Array) }));
    });

    it('does not end a step that does not run (a room open again on resume)', () => {
        const steps = new LoadSteps(null, { clock: () => 5, perf: perf() });
        steps.done('room');
        steps.fail('server');
        expect(steps.snapshot().steps.map(step => step.state)).toEqual(['done', 'wait', 'wait']);
    });

    it('marks a step that failed', () => {
        const steps = new LoadSteps(null, { clock: () => 5, perf: perf() });
        steps.start('room');
        steps.fail('room');
        expect(steps.snapshot().steps[2].state).toBe('fail');
    });

    it('keeps the last lines only', () => {
        const steps = new LoadSteps(null, { clock: () => 1, perf: perf() });
        for (let i = 0; i < 200; i++) steps.log('x', 'line ' + i);
        const { lines } = steps.snapshot();
        expect(lines.length).toBe(120);
        expect(lines[lines.length - 1].text).toBe('line 199');
    });
});

describe('bootLines', () => {
    it('lists the page, the app files and the early requests, in time order', () => {
        const lines = bootLines(perf({
            navigation: [{ startTime: 0, responseStart: 150, responseEnd: 320, transferSize: 5100 }],
            resource: [
                { name: 'http://x/api/__rtcConfig__', responseEnd: 600, duration: 180 },
                { name: 'http://x/assets/index-abc.js', responseEnd: 2400, duration: 2000, transferSize: 452000 },
                { name: 'http://x/logo.svg', responseEnd: 500, duration: 20, transferSize: 900 },
            ],
        }));
        expect(lines.map(line => line.text)).toEqual([
            expect.stringMatching(/^GET .* · 5\.1 kB · first byte 150 ms$/),
            'GET /api/__rtcConfig__ · 180 ms',
            'index-abc.js · 452 kB · 2.0 s',
        ]);
    });

    it('says when the app came from the cache', () => {
        const files = { resource: [{ name: 'http://x/assets/a.js', transferSize: 0, decodedBodySize: 9000, responseEnd: 9, duration: 3 }] };
        expect(bootLines(perf(files))[0].text).toBe('a.js · from the cache · 3 ms');
        expect(appDetail(perf(files))).toBe('from the cache');
    });

    it('adds up what the app files cost', () => {
        expect(appDetail(perf({ resource: [
            { name: 'http://x/assets/a.js', transferSize: 400000 },
            { name: 'http://x/assets/b.css', transferSize: 8000 },
        ] }))).toBe('408 kB');
    });
});

describe('formats', () => {
    it('writes sizes and times short', () => {
        expect(formatBytes(800)).toBe('800 B');
        expect(formatBytes(5100)).toBe('5.1 kB');
        expect(formatBytes(2400000)).toBe('2.4 MB');
        expect(formatMs(180.4)).toBe('180 ms');
        expect(formatMs(2300)).toBe('2.3 s');
    });
});
