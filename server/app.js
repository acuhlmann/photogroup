import express from 'express';
import path from 'path';
import { fileURLToPath } from 'url';
import { dirname } from 'path';
import { createWriteStream } from 'fs';
import ServerSetup from './ServerSetup.js';
import EventEmitter from 'eventemitter3';
import IceServers from './IceServers.js';
import IpTranslator from './IpTranslator.js';
import Tracker from './Tracker.js';
import Rooms from './Rooms.js';

// Helper for immediate logging with file backup (for PowerShell buffering issues)
const logFile = createWriteStream(path.join(dirname(fileURLToPath(import.meta.url)), 'server.log'), { flags: 'a' });
function logImmediate(...args) {
    const message = args.map(arg => typeof arg === 'object' ? JSON.stringify(arg) : String(arg)).join(' ') + '\n';
    console.log(...args);
    logFile.write(`[${new Date().toISOString()}] ${message}`);
}

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
    // Force unbuffered output for immediate logging
    if (process.stdout.isTTY) {
        process.stdout.setDefaultEncoding('utf8');
    }
    
    logImmediate('[App] ========================================');
    logImmediate('[App] Initializing PhotoGroup Server...');
    logImmediate('[App] IP translation enabled:', process.env.ENABLE_IP_LOOKUP !== 'false');
    logImmediate('[App] ========================================');

    const ice = new IceServers(updateChannel, remoteLog, app);
    await ice.start();
    logImmediate('[App] IceServers started');

    const tracker = new Tracker(updateChannel, remoteLog, app, emitter);
    await tracker.start();
    logImmediate('[App] Tracker started');

    const rooms = new Rooms(updateChannel, remoteLog, app, emitter, ice, tracker);
    rooms.start();
    logImmediate('[App] Rooms started');
    logImmediate('[App] Initialization complete - server ready');
}

init().catch(err => {
    console.error('Failed to initialize app:', err);
    process.exit(1);
});

const isMainModule = import.meta.url === `file://${process.argv[1]}` || process.argv[1]?.endsWith('app.js');

const started = new Promise((resolve, reject) => {

    if (isMainModule) {
        const server = app.listen(webPort, () => {
            const addr = server.address();
            if (addr) {
                const host = addr.address;
                const actualPort = addr.port;
                logImmediate(`[App] Server listening at ${host}:${actualPort}`);
            } else {
                logImmediate(`[App] Server listening on port ${webPort}`);
            }
            logImmediate('[App] Ready to accept connections');
            logImmediate('[App] Waiting for peers to connect...');
            resolve();
        });
        
        server.on('error', (err) => {
            if (err.code === 'EADDRINUSE') {
                console.error(`Error: Port ${webPort} is already in use. Please stop the other process or use a different port.`);
            } else {
                console.error('Server error:', err.message);
            }
            reject(err);
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
