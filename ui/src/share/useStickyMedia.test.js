import React, { act } from 'react';
import { createRoot } from 'react-dom/client';
import { afterEach, describe, expect, it } from 'vitest';
import { nextWide, useStickyUp, STICKY_BAND } from './useStickyMedia';

const setWidth = width => Object.defineProperty(window, 'innerWidth', { value: width, configurable: true });
const resizeTo = width => act(() => { setWidth(width); window.dispatchEvent(new Event('resize')); });

let root;
let div;
function show(breakpoint = 900) {
    div = document.createElement('div');
    document.body.appendChild(div);
    root = createRoot(div);
    const Probe = () => <div data-testid="wide">{String(useStickyUp(breakpoint))}</div>;
    act(() => root.render(<Probe />));
    return () => div.querySelector('[data-testid="wide"]').textContent;
}
afterEach(() => {
    if (root) act(() => root.unmount());
    if (div) div.remove();
    root = null;
    div = null;
});

describe('nextWide', () => {
    it('keeps the current layout inside the band around the breakpoint', () => {
        // An unfolded foldable sits at about 880 CSS px, 20 px under MUI's
        // 900 px `md` breakpoint: small width changes must not flip it.
        expect(nextWide(false, 880, 900)).toBe(false);
        expect(nextWide(false, 899, 900)).toBe(false);
        expect(nextWide(false, 900 + STICKY_BAND - 1, 900)).toBe(false);
        expect(nextWide(true, 900, 900)).toBe(true);
        expect(nextWide(true, 900 - STICKY_BAND, 900)).toBe(true);
    });

    it('switches only after crossing the whole band', () => {
        expect(nextWide(false, 900 + STICKY_BAND, 900)).toBe(true);
        expect(nextWide(true, 900 - STICKY_BAND - 1, 900)).toBe(false);
    });
});

describe('useStickyUp', () => {
    it('does not flap when resize events jitter across the fold breakpoint', () => {
        window.matchMedia = query => ({
            matches: false, media: query,
            addListener: () => {}, removeListener: () => {},
            addEventListener: () => {}, removeEventListener: () => {},
        });
        setWidth(880);
        const wide = show();
        expect(wide()).toBe('false');
        // Browser chrome, a scrollbar or a half-fold nudges the width back
        // and forth over 900: the layout (and every tile in it) stays put.
        for (const width of [905, 895, 915, 885, 920, 890]) resizeTo(width);
        expect(wide()).toBe('false');
        // A real fold/unfold crosses the band completely.
        resizeTo(1000);
        expect(wide()).toBe('true');
        for (const width of [910, 890, 905, 880]) resizeTo(width);
        expect(wide()).toBe('true');
        resizeTo(800);
        expect(wide()).toBe('false');
    });
});
