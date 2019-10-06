//import registerServiceWorker from './registerServiceWorker';
import { unregister } from './registerServiceWorker';

import 'core-js';
import React from 'react';
import ReactDOM from 'react-dom';
import './index.css';
import App from './App';
import { NativeEventSource, EventSourcePolyfill } from 'event-source-polyfill';
//import adapter from 'webrtc-adapter';

unregister();

const EventSource = NativeEventSource || EventSourcePolyfill;
// OR: may also need to set as global property
window.EventSource =  global.EventSource =  NativeEventSource || EventSourcePolyfill;

ReactDOM.render(<App />, document.getElementById('root'));

//registerServiceWorker();
unregister();
