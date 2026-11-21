// Polyfill global for Node.js modules that expect it
if (typeof global === 'undefined') {
  var global = window;
}

// Make Buffer available globally
import { Buffer } from 'buffer';
window.Buffer = Buffer;
global.Buffer = Buffer;
globalThis.Buffer = Buffer;

import { keepAppForOffline, prepareShareLaunch, registerShareTarget } from './share/shareTarget';
import { restoreRoomKey } from './share/privateRoom';
import { readPreference } from './share/preferences';
import { noteArrival } from './share/nearby/pairingLog';

import React from 'react';
import { createRoot } from 'react-dom/client';
import './index.css';
import AppWrapper from './AppWrapper';

// Every browser the app supports has EventSource. Only an old one loads the
// polyfill, so it is not in everyone's first download.
if (!window.EventSource) {
    import('event-source-polyfill').then(({ EventSourcePolyfill }) => {
        window.EventSource = global.EventSource = EventSourcePolyfill;
    }).catch(() => {});
}

// Photos shared from other apps open "/?shared=1"; send them to the last room before it is read.
prepareShareLaunch();
// A private room opened without "#k=…" gets the key this browser kept for it.
restoreRoomKey();
// A link from an NFC tag says so; geek mode shows it.
noteArrival();

const container = document.getElementById('root');
const root = createRoot(container);
root.render(<AppWrapper />);

// The only service worker receives photos shared from other apps. In a
// build it also keeps the app itself, so the app opens with no network.
registerShareTarget().then(() => {
    if (import.meta.env.PROD && !readPreference('dataSaver')) setTimeout(() => { keepAppForOffline(); }, 3000);
});
