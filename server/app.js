import express from 'express';
import path from 'path';
import { fileURLToPath } from 'url';
import { dirname } from 'path';
import ServerSetup from './ServerSetup.js';
import EventEmitter from 'eventemitter3';
import IceServers from './IceServers.js';
import IpTranslator from './IpTranslator.js';
import Tracker from './Tracker.js';
import Rooms from './Rooms.js';

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);
const webPort = process.env.PORT || 8081;

const setup = new ServerSetup();
setup.start();

const updateChannel = setup.updateChannel;
const remoteLog = setup.remoteLog.bind(setup);
const app = setup.app;

//------------Start app logic

const emitter = new EventEmitter();

async function init() {

    IpTranslator.lookedUpIPs = new Map();

    const ice = new IceServers(updateChannel, remoteLog, app);
    await ice.start();

    const tracker = new Tracker(updateChannel, remoteLog, app, emitter);
    await tracker.start();

    const rooms = new Rooms(updateChannel, remoteLog, app, emitter, ice, tracker);
    rooms.start();
}

init().catch(err => {
    console.error('Failed to initialize app:', err);
    process.exit(1);
});

const isMainModule = import.meta.url === `file://${process.argv[1]}` || process.argv[1]?.endsWith('app.js');

const started = new Promise((resolve, reject) => {

    if (isMainModule) {
        const server = app.listen(webPort, () => {
            const host = server.address().address;
            const actualPort = server.address().port;
            console.log(`App started at ${host}:${actualPort}`);
            resolve();
        });
    } else {
        // When imported as a module (e.g., in tests), resolve immediately
        // Give a small delay to allow initialization to complete
        setImmediate(() => resolve());
    }
});

app.get(/^\/index\./, (req, res) => {
    res.sendFile(path.join(__dirname, 'ui/index.html'));
});

app.get('/.well-known/pki-validation/AC5282DE1EF367EB3D1FCCD30628F8D9.txt', (req, res) => {
    res.sendFile(path.join(__dirname, 'secret/AC5282DE1EF367EB3D1FCCD30628F8D9.txt'));
});

export { app, started };
