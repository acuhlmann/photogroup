import React, { act } from 'react';
import { createRoot } from 'react-dom/client';
import { afterEach, describe, expect, it, vi } from 'vitest';
import EventEmitter from 'eventemitter3';
import RoomLoading, { DONE_SHOW_MS, FAILED_ROOM_TEXT, OPEN_TEXT, SLOW_SERVER_TEXT, STEP_RUNNING, currentStep, slowNote } from './RoomLoading';
import LoadSteps from './loadSteps';

const noPerf = { getEntriesByType: () => [] };

describe('RoomLoading', () => {
    let root;
    let container;
    afterEach(() => {
        act(() => root.unmount());
        container.remove();
        vi.useRealTimers();
    });

    function setup(mode, props = {}) {
        const emitter = new EventEmitter();
        const master = { emitter, loadSteps: new LoadSteps(emitter, { perf: noPerf }) };
        container = document.createElement('div');
        document.body.appendChild(container);
        root = createRoot(container);
        const render = next => act(() => root.render(<RoomLoading master={master} mode={mode} {...props} {...next} />));
        render();
        return { master, render };
    }

    const bar = () => container.querySelector('[data-testid="room-loading"]');
    const states = () => [...container.querySelectorAll('[data-step]')].map(node => node.dataset.state);
    const side = () => container.querySelector('[data-side]')?.textContent;

    it('is a small bar that says the step that runs, and has all steps on a tap', () => {
        const { master } = setup('simple');
        expect(bar().getAttribute('role')).toBe('status');
        expect(bar().textContent).toContain(STEP_RUNNING.server);
        expect(side()).toBe('2 of 3');
        act(() => master.loadSteps.start('server'));
        expect(states()).toEqual(['done', 'run', 'wait']);
        act(() => { master.loadSteps.done('server'); master.loadSteps.start('room'); });
        expect(bar().textContent).toContain(STEP_RUNNING.room);
        expect(side()).toBe('3 of 3');
        const toggle = container.querySelector('[aria-expanded]');
        expect(toggle.getAttribute('aria-expanded')).toBe('false');
        act(() => toggle.click());
        expect(toggle.getAttribute('aria-expanded')).toBe('true');
        expect(container.textContent).toContain('Connect to the server');
    });

    it('shows no times in simple mode, and times in Photographer mode', () => {
        setup('simple');
        expect(container.querySelector('[data-time]')).toBeNull();
        act(() => root.unmount());
        container.remove();
        setup('default');
        expect(container.querySelectorAll('[data-time]').length).toBe(3);
    });

    it('shows the real events in geek mode, the last one in the bar', () => {
        const { master } = setup('geek');
        act(() => master.loadSteps.log('api', 'POST /api/rooms/abc… · 200 · 240 ms'));
        expect(bar().textContent).toContain('POST /api/rooms/abc… · 200 · 240 ms');
        expect(container.querySelector('[data-testid="load-lines"]').textContent).toContain('POST /api/rooms/abc… · 200 · 240 ms');
    });

    it('offers to try again when the room cannot open', () => {
        const { master } = setup('simple');
        act(() => { master.loadSteps.start('room'); master.loadSteps.fail('room'); });
        expect(bar().textContent).toContain(FAILED_ROOM_TEXT);
        expect([...container.querySelectorAll('button')].some(button => button.textContent === 'Try again')).toBe(true);
    });

    it('says the room is open for a moment, then goes', () => {
        vi.useFakeTimers();
        const { master, render } = setup('simple');
        act(() => { master.loadSteps.start('server'); master.loadSteps.done('server'); master.loadSteps.start('room'); master.loadSteps.done('room'); });
        render({ synced: true });
        expect(bar().dataset.done).toBe('yes');
        expect(bar().textContent).toContain(OPEN_TEXT);
        act(() => vi.advanceTimersByTime(DONE_SHOW_MS));
        // Then it folds away.
        act(() => vi.advanceTimersByTime(1000));
        expect(bar()).toBeNull();
    });

    it('does not show at all when the room is already open', () => {
        const emitter = new EventEmitter();
        const master = { emitter, loadSteps: new LoadSteps(emitter, { perf: noPerf }) };
        container = document.createElement('div');
        document.body.appendChild(container);
        root = createRoot(container);
        act(() => root.render(<RoomLoading master={master} mode="simple" synced />));
        expect(bar()).toBeNull();
    });
});

describe('slowNote', () => {
    it('says the server starts when it does not answer for a while', () => {
        const steps = [{ id: 'server', state: 'run', startedAt: 0 }];
        expect(slowNote(steps, 1000)).toBe('');
        expect(slowNote(steps, 5000)).toBe(SLOW_SERVER_TEXT);
    });
});

describe('currentStep', () => {
    it('is the step that runs, else the next one that waits', () => {
        expect(currentStep([{ id: 'app', state: 'done' }, { id: 'server', state: 'wait' }]).id).toBe('server');
        expect(currentStep([{ id: 'server', state: 'done' }, { id: 'room', state: 'run' }]).id).toBe('room');
        expect(currentStep([{ id: 'room', state: 'done' }])).toBeNull();
    });
});
