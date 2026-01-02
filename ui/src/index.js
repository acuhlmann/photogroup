// Polyfill global for Node.js modules that expect it
if (typeof global === 'undefined') {
  var global = window;
}

// Make Buffer available globally
import { Buffer } from 'buffer';
window.Buffer = Buffer;
global.Buffer = Buffer;
globalThis.Buffer = Buffer;

import * as serviceWorker from './serviceWorker';

import 'core-js';
import React from 'react';
import { createRoot } from 'react-dom/client';
import './index.css';
import AppWrapper from './AppWrapper';
import { NativeEventSource, EventSourcePolyfill } from 'event-source-polyfill';

const EventSource = NativeEventSource || EventSourcePolyfill;
// OR: may also need to set as global property
window.EventSource =  global.EventSource =  NativeEventSource || EventSourcePolyfill;

const container = document.getElementById('root');
const root = createRoot(container);
root.render(<AppWrapper />);

// If you want your app to work offline and load faster, you can change
// unregister() to register() below. Note this comes with some pitfalls.
// Learn more about service workers: https://bit.ly/CRA-PWA
serviceWorker.unregister();
