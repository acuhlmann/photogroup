import React, { act } from 'react';
import { createRoot } from 'react-dom/client';
import { afterEach, describe, expect, it, vi } from 'vitest';
import EventEmitter from 'eventemitter3';
import RoomLoading, { FAILED_ROOM_TEXT, GIVE_UP_MS, SLOW_SERVER_TEXT, slowNote } from './RoomLoading';
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
        act(() => root.render(<RoomLoading master={master} mode={mode} {...props} />));
        return master;
    }

    const states = () => [...container.querySelectorAll('[data-step]')].map(node => node.dataset.state);

    it('shows the steps of opening the room, and each change', () => {
        const master = setup('simple', { roomName: 'Beach day' });
        expect(container.textContent).toContain('Opening “Beach day”');
        expect(container.textContent).toContain('Load the app');
        expect(container.textContent).toContain('Connect to the server');
        expect(container.textContent).toContain('Join the room');
        expect(states()).toEqual(['done', 'wait', 'wait']);
        act(() => master.loadSteps.start('server'));
        expect(states()).toEqual(['done', 'run', 'wait']);
        act(() => { master.loadSteps.done('server'); master.loadSteps.start('room'); });
        expect(states()).toEqual(['done', 'done', 'run']);
    });

    it('shows no times in simple mode, and times in Photographer mode', () => {
        setup('simple');
        expect(container.querySelector('[data-time]')).toBeNull();
        act(() => root.unmount());
        container.remove();
        setup('default');
        expect(container.querySelectorAll('[data-time]').length).toBe(3);
    });

    it('shows the real events in geek mode', () => {
        const master = setup('geek');
        act(() => master.loadSteps.log('api', 'POST /api/rooms/abc… · 200 · 240 ms'));
        expect(container.querySelector('[data-testid="load-lines"]').textContent).toContain('POST /api/rooms/abc… · 200 · 240 ms');
    });

    it('offers to try again and to show the room when the room cannot open', () => {
        const onGiveUp = vi.fn();
        const master = setup('simple', { onGiveUp });
        act(() => { master.loadSteps.start('room'); master.loadSteps.fail('room'); });
        expect(container.textContent).toContain(FAILED_ROOM_TEXT);
        const show = [...container.querySelectorAll('button')].find(button => button.textContent === 'Show the room');
        act(() => show.click());
        expect(onGiveUp).toHaveBeenCalled();
    });

    it('offers a way on when the room takes very long', () => {
        vi.useFakeTimers();
        setup('simple', { onGiveUp: () => {} });
        expect(container.textContent).not.toContain('Try again');
        act(() => vi.advanceTimersByTime(GIVE_UP_MS));
        expect(container.textContent).toContain('Try again');
    });
});

describe('slowNote', () => {
    it('says the server starts when it does not answer for a while', () => {
        const steps = [{ id: 'server', state: 'run', startedAt: 0 }];
        expect(slowNote(steps, 1000)).toBe('');
        expect(slowNote(steps, 5000)).toBe(SLOW_SERVER_TEXT);
    });
});
