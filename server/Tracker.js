//-----------------Custom WebTorrent Tracker - ICE Events
import { inspect } from 'util';
import IpTranslator from './IpTranslator.js';
import transform from 'sdp-transform';
import _ from 'lodash';
import { Server } from 'bittorrent-tracker';

const wsPort = process.env.WS_PORT || 9000;
// Use localhost instead of 0.0.0.0 to avoid binding issues on Windows
const hostname = process.env.WS_HOST || '127.0.0.1';

export default class Tracker {

    constructor(updateChannel, remoteLog, app, emitter) {
        this.updateChannel = updateChannel;
        this.remoteLog = remoteLog;
        this.app = app;
        this.emitter = emitter;
    }

    async start() {
        const onlistening = this.handleEvent.bind(this);
        const remoteLog = this.remoteLog;
        const app = this.app;

        const server = new Server({
            udp: true, // enable udp server? [default=true]
            http: true, // enable http server? [default=true]
            ws: true, // enable websocket server? [default=true]
            stats: true, // enable web-based statistics? [default=true]
            trustProxy: true
        });

        // Internal http, udp, and websocket servers exposed as public properties.
        server.http;
        server.udp;
        server.ws;

        server.on('warning', function (err) {
            // client sent bad data. probably not a problem, just a buggy client.
            remoteLog(err.message)
        });

        server.on('listening', (...theArgs) => {
            // fired when all requested servers are listening
            console.log('listening on http port:' + server.http.address().port);
            console.log('listening ' + inspect(theArgs));
            //console.log('listening on udp port:' + server.udp.address().port)
        });


        const onHttpRequest = server.onHttpRequest.bind(server);
        function onHttpRequest2(param1, param2, param3) {
            console.log('onHttpRequest2');
            onHttpRequest();
        }
        app.get('/announce', onHttpRequest);
        app.get('/scrape', onHttpRequest);
        //server.listen(8080);

        // start tracker server listening! Use 0 to listen on a random free port.
        // Note: bittorrent-tracker's listen() signature is: listen(port, hostname, callback)
        // But the callback is actually the 'listening' event handler, not a parameter
        server.on('listening', onlistening);
        
        // Track if we've already tried the fallback to prevent double listening
        let hasTriedFallback = false;
        
        server.on('error', function(err) {
            // Ignore "server already listening" errors as they're expected during retry
            if (err.message && err.message.includes('server already listening')) {
                console.log('Tracker: Server already listening (expected during retry), ignoring error');
                return;
            }
            
            if ((err.code === 'EADDRINUSE' || err.message.includes('EINVAL') || err.code === 'EINVAL') && !hasTriedFallback) {
                console.error(`Tracker: Port ${wsPort} is in use or invalid. Trying random port...`);
                hasTriedFallback = true;
                // Try to listen on random port, catch any errors including "already listening"
                try {
                    server.listen(0, hostname);
                } catch (listenErr) {
                    if (listenErr.message && listenErr.message.includes('server already listening')) {
                        console.log('Tracker: Server already listening, continuing with current state');
                    } else {
                        console.error(`Tracker: Failed to listen on random port:`, listenErr.message);
                        remoteLog('Tracker error: ' + listenErr.message);
                    }
                }
            } else {
                remoteLog('Tracker error: ' + err.message);
            }
        });
        
        try {
            server.listen(wsPort, hostname);
            console.log(`Tracker attempting to listen on ${hostname}:${wsPort}`);
        } catch (err) {
            if (!hasTriedFallback) {
                console.error(`Tracker: Failed to bind to ${hostname}:${wsPort}, trying random port:`, err.message);
                hasTriedFallback = true;
                try {
                    server.listen(0, hostname);
                } catch (listenErr) {
                    if (listenErr.message && listenErr.message.includes('server already listening')) {
                        console.log('Tracker: Server already listening, continuing with current state');
                    } else {
                        console.error(`Tracker: Failed to listen on random port:`, listenErr.message);
                        remoteLog('Tracker error: ' + listenErr.message);
                    }
                }
            }
        }

        // listen for individual tracker messages from peers:

        //server.on('start', (...theArgs) => {
        //    console.log('got start message from ' + theArgs[0] + ': ' + theArgs[1].addr);
        // console.log('got start message from ' + theArgs[0] + ': ' + theArgs[1].addr + ': ' + theArgs[1].offers[0].offer.sdp);
        //console.log('got start message from ' + theArgs[0]);
        //});

        //server.on('complete', (...theArgs) => {
        //    console.log('got complete message from ' + theArgs[0]);
        //});

        server.on('start', onlistening);
        server.on('update', onlistening);
        server.on('complete', onlistening);
        server.on('stop', onlistening);

        // get info hashes for all torrents in the tracker server
        Object.keys(server.torrents);
    }

    handleEvent(...theArgs) {

        const remoteLog = this.remoteLog;
        const peerId = theArgs[0];
        const data = theArgs[1];
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
};