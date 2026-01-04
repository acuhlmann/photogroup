//-----------------Custom WebTorrent Tracker - ICE Events
import { inspect } from 'util';
import { createServer } from 'net';
import IpTranslator from './IpTranslator.js';
import transform from 'sdp-transform';
import _ from 'lodash';
import { Server } from 'bittorrent-tracker';

const preferredWsPort = process.env.WS_PORT || 9000;
// Use localhost instead of 0.0.0.0 to avoid binding issues on Windows
const hostname = process.env.WS_HOST || '127.0.0.1';

/**
 * Check if a port is available
 * @param {number} port - Port to check
 * @param {string} host - Host to bind to
 * @returns {Promise<boolean>} - True if port is available
 */
function isPortAvailable(port, host) {
    return new Promise((resolve) => {
        const server = createServer();
        server.once('error', () => {
            resolve(false);
        });
        server.once('listening', () => {
            server.close(() => {
                resolve(true);
            });
        });
        server.listen(port, host);
    });
}

/**
 * Find an available port, starting with the preferred port
 * @param {number} preferredPort - Preferred port to try first
 * @param {string} host - Host to bind to
 * @returns {Promise<number>} - Available port (0 for random if all else fails)
 */
async function findAvailablePort(preferredPort, host) {
    // Try preferred port first
    if (await isPortAvailable(preferredPort, host)) {
        return preferredPort;
    }
    console.log(`Port ${preferredPort} is in use, trying alternatives...`);
    
    // Try a few nearby ports
    for (let offset = 1; offset <= 10; offset++) {
        const tryPort = preferredPort + offset;
        if (await isPortAvailable(tryPort, host)) {
            console.log(`Found available port: ${tryPort}`);
            return tryPort;
        }
    }
    
    // Fall back to random port (0)
    console.log('No nearby ports available, using random port');
    return 0;
}

export default class Tracker {

    constructor(updateChannel, remoteLog, app, emitter) {
        this.updateChannel = updateChannel;
        this.remoteLog = remoteLog;
        this.app = app;
        this.emitter = emitter;
        
        // Store the actual WebSocket URL after server starts listening
        this.wsUrl = null;
        this.wsPort = null;
    }
    
    /**
     * Get the WebSocket URL for the tracker
     * @returns {string|null} The WebSocket URL or null if not yet listening
     */
    getWsUrl() {
        return this.wsUrl;
    }
    
    /**
     * Get the WebSocket port for the tracker
     * @returns {number|null} The port number or null if not yet listening
     */
    getWsPort() {
        return this.wsPort;
    }

    async start() {
        const remoteLog = this.remoteLog;
        const app = this.app;
        const self = this;
        
        // Find an available port BEFORE starting the tracker
        const wsPort = await findAvailablePort(preferredWsPort, hostname);
        console.log(`Tracker will use port: ${wsPort === 0 ? 'random' : wsPort}`);
        
        // Store the intended port immediately so the API endpoint can use it
        // even before the server is fully listening (avoids race condition)
        this.wsPort = wsPort;

        const server = new Server({
            udp: false, // disable udp server - not needed for WebRTC and causes EINVAL on Windows
            http: true, // enable http server? [default=true]
            ws: true, // enable websocket server? [default=true]
            stats: true, // enable web-based statistics? [default=true]
            trustProxy: true
        });
        
        this.server = server;

        // Internal http, udp, and websocket servers exposed as public properties.
        server.http;
        server.udp;
        server.ws;

        server.on('warning', function (err) {
            // client sent bad data. probably not a problem, just a buggy client.
            remoteLog(err.message)
        });

        // Create a promise that resolves when the server is listening
        const listeningPromise = new Promise((resolve, reject) => {
            const timeout = setTimeout(() => {
                reject(new Error('Tracker failed to start within 10 seconds'));
            }, 10000);
            
            server.once('listening', (...theArgs) => {
                clearTimeout(timeout);
                // fired when all requested servers are listening
                const httpPort = server.http.address().port;
                console.log('Tracker listening on http port: ' + httpPort);
                
                // Update with actual port (should match, but use server's reported port to be safe)
                self.wsPort = httpPort;
                self.wsUrl = `ws://${hostname}:${httpPort}`;
                console.log(`Tracker WebSocket URL: ${self.wsUrl}`);
                resolve(httpPort);
            });
            
            server.once('error', (err) => {
                clearTimeout(timeout);
                console.error('Tracker error during startup:', err.message);
                reject(err);
            });
        });
        
        // Register the tracker config API endpoint
        this.registerTrackerConfigEndpoint();

        const onHttpRequest = server.onHttpRequest.bind(server);
        app.get('/announce', onHttpRequest);
        app.get('/scrape', onHttpRequest);
        
        server.on('error', function(err) {
            // Log tracker errors but don't crash
            console.error('Tracker error:', err.message);
            remoteLog('Tracker error: ' + err.message);
        });
        
        // Start listening on the available port
        console.log(`Tracker starting on ${hostname}:${wsPort}`);
        server.listen(wsPort, hostname);
        
        // Wait for the server to be listening
        try {
            await listeningPromise;
            console.log('Tracker started successfully');
        } catch (err) {
            console.error('Tracker failed to start:', err.message);
            // Set a fallback URL so the API doesn't return null
            // Use self.wsPort which was set earlier with the intended port
            if (!self.wsUrl) {
                self.wsUrl = `ws://${hostname}:${self.wsPort}`;
                console.log(`Using fallback tracker URL: ${self.wsUrl}`);
            }
        }

        // listen for individual tracker messages from peers:
        // These events are for peer activity, not the 'listening' event
        const onPeerEvent = this.handleEvent.bind(this);
        server.on('start', onPeerEvent);
        server.on('update', onPeerEvent);
        server.on('complete', onPeerEvent);
        server.on('stop', onPeerEvent);

        // get info hashes for all torrents in the tracker server
        Object.keys(server.torrents);
    }

    handleEvent(...theArgs) {

        const remoteLog = this.remoteLog;
        const peerId = theArgs[0];
        const data = theArgs[1];
        
        // Guard against undefined data (can happen during some events)
        if (!data) {
            console.log('handleEvent called with no data, peerId:', peerId);
            return;
        }
        
        let peerIdStr = peerId;
        if(data.to_peer_id) {
            peerIdStr = peerId + ' to ' + data.to_peer_id;
        }

        const offers = data.offers;
        const answer = data.answer;
        const event = data.event;
        const date = new Date();
        const time = date.getMinutes() + ':' + date.getSeconds() + ':' + date.getMilliseconds();
        const listener = 'pg tracker ' + time + ' '  + event + ' ' + peerIdStr + ': ' + data.addr + ': ';
        let jsonSdp, sdp = '';
        if(offers) {
            jsonSdp = transform.parse(data.offers[0].offer.sdp);
            sdp = 'offers ' + data.offers.length;
            this.sendIceMsg('iceOffer', peerId, event, jsonSdp, data.addr, data.info_hash);
            remoteLog(listener + sdp);
        } else if(answer) {
            jsonSdp = transform.parse(data.answer.sdp);
            sdp = 'answer ' + data.answer.type;
            this.sendIceMsg('iceAnswer', peerId, event, jsonSdp, data.addr, data.info_hash);
            remoteLog(listener + sdp);
        } else if(event === 'stopped' || event === 'completed') {
            this.sendIceMsg('iceDone', peerId, event, null, data.addr, data.info_hash);
            remoteLog(listener);
        } else {
            remoteLog(inspect(theArgs));
        }

        //console.log('onlistening ' + util.inspect(theArgs));
    }

    sendIceMsg(iceEvent, peerId, event, jsonSdp, addr, infoHash) {

        if(jsonSdp) {
            const stripped = this.mapSdp(jsonSdp);
            const withIpObj = stripped.map(ip => {
                ip.typeDetail = ip.type;
                ip.transportsLabel = ip.transport;
                ip.ports = [ip.port];
                ip.network = IpTranslator.createEmptyIpObj(ip.ip);
                return ip;
            });
            IpTranslator.enrichCandidateIPs(withIpObj).then(sdp => {

                this.sendIceEvent(iceEvent, peerId, event, sdp, addr, infoHash);
            });
        } else {

            this.sendIceEvent(iceEvent, peerId, event, jsonSdp, addr, infoHash);
        }
    }

    mapSdp(sdp) {
        return sdp.media[0].candidates.map(item => {
            return {
                ip: item.ip,
                port: item.port,
                transport: item.transport,
                type: item.type
            }
        }).reverse();
    }

    sendIceEvent(iceEvent, peerId, event, sdp, addr, infoHash) {
        const sharedBy = peerId; //this.peers.webPeers.get(peerId);
        const newEvent = {
            event: 'iceEvent',
            data: {
                type: iceEvent,
                sharedBy: sharedBy,
                event: event,
                sdp: sdp,
                addr: addr,
                infoHash: infoHash
            }
        };

        if(sharedBy) {
            this.emitter.emit('iceEvent', newEvent.data);
            //this.updateChannel.send(newEvent);
        }
    }
    
    /**
     * Register the API endpoint to expose tracker configuration
     */
    registerTrackerConfigEndpoint() {
        const self = this;
        
        this.app.get('/api/__trackerConfig__', (req, res) => {
            // Return the tracker WebSocket URL for clients to connect to
            const isLocal = req.hostname === 'localhost' || req.hostname === '127.0.0.1';
            
            let wsUrl;
            if (isLocal) {
                // For local development, use the actual WebSocket URL from the tracker
                if (self.wsUrl) {
                    wsUrl = self.wsUrl;
                } else {
                    // Tracker not fully ready yet, but use the intended port (set early in start())
                    wsUrl = `ws://127.0.0.1:${self.wsPort}`;
                }
            } else {
                // For production, use secure WebSocket through the main server
                wsUrl = `wss://${req.hostname}/ws`;
            }
            
            console.log(`Serving tracker config: ${wsUrl} (ready: ${!!self.wsUrl})`);
            
            res.json({
                comment: 'WARNING: This is *NOT* a public endpoint. Do not depend on it in your app',
                wsUrl: wsUrl,
                port: self.wsPort,
                ready: !!self.wsUrl
            });
        });
    }
};