import Logger from 'js-logger';
import { readPreference } from '../preferences';
import { prepareReader, prepareWriter } from './qrCodec';
import { loadModem } from './soundModem';

// The nearby channels are for when the server does not answer. Their code
// (the QR reader and writer, the sound modem) loads on first use as a rule,
// and with no server that load fails. So it is fetched soon after a room
// opens, while the server is there. About 1.8 MB, once; the browser keeps it.

const WAIT_MS = 4000;
let started = null;

/** Fetch the code of the nearby channels now. Resolves when all of it is here or has failed. */
export function loadNearbyCode() {
    if (!started) {
        started = Promise.allSettled([
            prepareReader(),
            prepareWriter(),
            loadModem(),
            import('./LightSend'),
        ]).then((results) => {
            const failed = results.filter(result => result.status === 'rejected').length;
            if (failed) {
                Logger.warn(`Nearby channels: ${failed} part(s) did not load`);
                started = null;
            }
            // For tests, and for a look in the browser's inspector.
            if (!failed && typeof document !== 'undefined') document.documentElement.dataset.nearbyCode = 'ready';
            return failed === 0;
        });
    }
    return started;
}

/** Fetch it a few seconds after the room opened, when the page is idle. Not with "Data saver". */
export function loadNearbyCodeSoon({ wait = WAIT_MS } = {}) {
    if (started || readPreference('dataSaver') || import.meta.env?.MODE === 'test') return;
    const idle = typeof window !== 'undefined' && window.requestIdleCallback
        ? callback => window.requestIdleCallback(callback, { timeout: 5000 })
        : callback => callback();
    setTimeout(() => idle(() => { loadNearbyCode(); }), wait);
}
