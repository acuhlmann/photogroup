import { useEffect, useState } from 'react';

/**
 * How far past a breakpoint the width must go before the layout follows it,
 * in CSS pixels. An unfolded foldable (an Honor Magic V5, say) is about
 * 880 CSS px wide: 20 px under MUI's 900 px `md` breakpoint, which switches
 * the photographer list between phone rows and the wide table, the viewer
 * between stacked and side-by-side, and the geek stage's drawer. Browser
 * chrome, a scrollbar appearing, a half-fold or a split-screen divider can
 * nudge the width back and forth over that line, and every crossing used to
 * remount the whole layout — every tile, thumbnail and image with it — which
 * is the flicker seen on that phone. Inside the band the layout stays as it
 * is; a real fold, unfold or rotation crosses the band completely.
 */
export const STICKY_BAND = 24;

/** Whether `width` counts as at least `breakpoint`, given the layout in use. */
export function nextWide(wide, width, breakpoint, band = STICKY_BAND) {
    if (width >= breakpoint + band) return true;
    if (width < breakpoint - band) return false;
    return wide;
}

const matches = query => {
    if (typeof window === 'undefined' || typeof window.matchMedia !== 'function') return null;
    try { return window.matchMedia(query).matches; } catch { return null; }
};

const initialWide = breakpoint => {
    const up = matches(`(min-width:${breakpoint}px)`);
    if (up != null) return up;
    return typeof window !== 'undefined' && window.innerWidth >= breakpoint;
};

const initialNarrow = breakpoint => {
    // MUI's `down` breakpoint ends a hair under the next one.
    const down = matches(`(max-width:${breakpoint - 0.05}px)`);
    if (down != null) return down;
    return typeof window !== 'undefined' && window.innerWidth < breakpoint;
};

/**
 * Like MUI's `useMediaQuery(theme.breakpoints.up(...))`, but sticky inside
 * STICKY_BAND of the breakpoint: resize events (fold, rotation, chrome and
 * scrollbar churn all arrive as resizes) only flip the answer once the width
 * has crossed the whole band. The first render answers for the width the
 * page opened at, so nothing remounts on load.
 */
function useStickyWide(breakpoint, startWide) {
    const [wide, setWide] = useState(startWide);
    useEffect(() => {
        // A fold or a divider drag fires a burst of resizes. The functional
        // update keeps the current layout inside the band, so React bails
        // out of those renders: only a crossing re-renders, once.
        const onResize = () => setWide(current => nextWide(current, window.innerWidth, breakpoint));
        window.addEventListener('resize', onResize);
        window.addEventListener('orientationchange', onResize);
        return () => {
            window.removeEventListener('resize', onResize);
            window.removeEventListener('orientationchange', onResize);
        };
    }, [breakpoint]);
    return wide;
}

export function useStickyUp(breakpoint) {
    return useStickyWide(breakpoint, () => initialWide(breakpoint));
}

/** Like MUI's `useMediaQuery(theme.breakpoints.down(...))`, with the same stickiness. */
export function useStickyDown(breakpoint) {
    return !useStickyWide(breakpoint, () => !initialNarrow(breakpoint));
}
