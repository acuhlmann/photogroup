import { flushSync } from 'react-dom';

export function prefersReducedMotion() {
    return window.matchMedia('(prefers-reduced-motion: reduce)').matches;
}

export function supportsViewTransition() {
    return typeof document.startViewTransition === 'function' && !prefersReducedMotion();
}

/** Run a React state update inside a same-document view transition when the browser can. */
export function runViewTransition(update) {
    if (supportsViewTransition()) {
        document.startViewTransition(() => {
            flushSync(update);
        });
        return;
    }
    update();
}

export function photoTransitionName(infoHash) {
    if (!infoHash) return undefined;
    const safe = String(infoHash).replace(/[^a-zA-Z0-9_-]/g, '');
    return safe ? `photo-${safe}` : undefined;
}
