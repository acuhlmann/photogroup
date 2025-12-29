//-----------------Custom WebTorrent Tracker - ICE Events
const util = require('util');
const IpTranslator = require('./IpTranslator');
const transform = require('sdp-transform');
const _ = require('lodash');

const wsPort = process.env.WS_PORT || 9000;
const hostname = '0.0.0.0';

module.exports = class Tracker {

    constructor(updateChannel, remoteLog, app, emitter) {
        this.updateChannel = updateChannel;
        this.remoteLog = remoteLog;
        this.app = app;
        this.emitter = emitter;
    }

    start() {
        const onlistening = this.handleEvent.bind(this);
        const remoteLog = this.remoteLog;
        const app = this.app;

        const Server = require('bittorrent-tracker').Server;

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

        server.on('error', function (err) {
            // fatal server error!
            remoteLog(err.message)
        });

        server.on('warning', function (err) {
            // client sent bad data. probably not a problem, just a buggy client.
            remoteLog(err.message)
        });

        server.on('listening', (...theArgs) => {
            // fired when all requested servers are listening
            console.log('listening on http port:' + server.http.address().port);
            console.log('listening ' + util.inspect(theArgs));
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
        server.listen(wsPort, hostname, onlistening);

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
            remoteLog(util.inspect(theArgs));
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