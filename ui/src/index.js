// Polyfill global for Node.js modules that expect it
if (typeof global === 'undefined') {
  var global = window;
}

// Make Buffer available globally
import { Buffer } from 'buffer';
window.Buffer = Buffer;
global.Buffer = Buffer;
globalThis.Buffer = Buffer;

import { prepareShareLaunch, registerShareTarget } from './share/shareTarget';

import 'core-js';
import React from 'react';
import { createRoot } from 'react-dom/client';
import './index.css';
import AppWrapper from './AppWrapper';
import { NativeEventSource, EventSourcePolyfill } from 'event-source-polyfill';

const EventSource = NativeEventSource || EventSourcePolyfill;
// OR: may also need to set as global property
window.EventSource =  global.EventSource =  NativeEventSource || EventSourcePolyfill;

// Photos shared from other apps open "/?shared=1"; send them to the last room before it is read.
prepareShareLaunch();

const container = document.getElementById('root');
const root = createRoot(container);
root.render(<AppWrapper />);

// The only service worker receives photos shared from other apps; it caches nothing.
registerShareTarget();
