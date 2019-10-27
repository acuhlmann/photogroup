//import registerServiceWorker from './registerServiceWorker';
import * as serviceWorker from './serviceWorker';

import 'core-js';
import React from 'react';
import ReactDOM from 'react-dom';
import './index.css';
import App from './App';
import { NativeEventSource, EventSourcePolyfill } from 'event-source-polyfill';
//import adapter from 'webrtc-adapter';

const EventSource = NativeEventSource || EventSourcePolyfill;
// OR: may also need to set as global property
window.EventSource =  global.EventSource =  NativeEventSource || EventSourcePolyfill;

ReactDOM.render(<App />, document.getElementById('root'));

// If you want your app to work offline and load faster, you can change
// unregister() to register() below. Note this comes with some pitfalls.
// Learn more about service workers: https://bit.ly/CRA-PWA
serviceWorker.register();
