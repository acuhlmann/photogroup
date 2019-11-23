//-------------------Web Peers

const IpTranslator = require('./IpTranslator');
const _ = require('lodash');

module.exports = class Peers {

    constructor(updateChannel, remoteLog, app, emitter) {
        this.updateChannel = updateChannel;
        this.remoteLog = remoteLog;
        this.app = app;
        this.emitter = emitter;

        this.clientsBySessionId = new Map();
        this.webPeers = new Map();
        this.peerIdBySessionId = new Map();
        IpTranslator.lookedUpIPs = new Map();
    }

    reset() {
        this.webPeers.clear();
        this.peerIdBySessionId.clear();
    }

    start() {

        this.setupSSE();

        this.app.get('/api/peers/', (request, response) => {

            const peerId = request.query.peerId;
            if(this.webPeers.has(peerId)) {
                const peer = this.webPeers.get(peerId);
                response.send(peer);
            } else {
                response.status(404).send({ iceServers: [] });
            }
        });

        this.app.post('/api/peers/', (request, response) => {

            const ips = IpTranslator.extractIps(request);
            const sessionId = request.body.sessionId;
            const peerId = request.body.peerId;

            if(this.peerIdBySessionId.has(sessionId)) {

                this.peerIdBySessionId.set(sessionId, peerId);

                let peer;
                if(this.webPeers.has(peerId)) {
                    peer = this.webPeers.get(peerId);
                } else {
                    peer = {peerId: peerId};
                }

                peer.name = request.body.name;
                peer.sessionId = sessionId;
                peer.originPlatform = request.body.originPlatform;
                peer.ips = ips.map(ip => IpTranslator.createEmptyIpObj(ip))

                this.webPeers.set(peer.peerId, peer);

                Promise.all(ips
                    .map(ip => IpTranslator.getLookupIp(ip)))
                    .then(results => peer.ips = results)
                    .then(() => {

                        this.emitter.emit('event', 'info', 'peerConnect', Peers.peerToAppPeer(peer));

                        this.webPeers.set(peer.peerId, peer);
                        this.sendWebPeers();
                        response.send(peer);
                    });


            } else {

                //if no sessionId, client has already disconnected and the addPeer request was inflight. Ignore.
                response.status(400).send();
            }
        });

        this.app.put('/api/peers/:id', (request, response) => {

            const id = request.params.id;
            const peer = this.webPeers.get(id);
            if(!peer) {

                return response.status(404).send('Peer not found');

            } else {

                const newItem = request.body;
                _.merge(peer, newItem);
                this.sendWebPeers();
                response.send(peer);
            }
        });
    }

    setupSSE() {
        this.updateChannel.on('connect', (channel, request) => {

            const sessionId = request.query.sessionId;

            this.peerIdBySessionId.set(sessionId, sessionId);

            //console.warn('connect sessionId ' + sessionId + ' size ' + this.peerIdBySessionId.size);
            this.sendConnectionCount(channel.connectionCount);
        });

        this.updateChannel.on('disconnect', (channel, response) => {

            const sessionId = response.req.query.sessionId;
            const peerId = this.peerIdBySessionId.get(sessionId);
            //console.warn('disconnect sessionId ' + sessionId + ' ' + peerId);

            if(this.webPeers.has(peerId)) {

                this.emitter.emit('removeOwner', peerId);

                this.emitter.emit('event', 'warning', 'peerDisconnect',
                    Peers.peerToAppPeer(this.webPeers.get(peerId)));
                this.webPeers.delete(peerId);
                this.sendWebPeers();
            }

            this.peerIdBySessionId.delete(sessionId);
            this.clientsBySessionId.delete(sessionId);
            this.emitter.emit('disconnectPeer', sessionId);

            this.sendConnectionCount(channel.connectionCount);
        });

        this.app.get('/api/updates/', (request, response) => {

            response.header('X-Accel-Buffering', 'no');
            const client = response;
            this.updateChannel.addClient(request, response, (error, foo) => {
                const sessionId = client.req.query.sessionId;
                this.clientsBySessionId.set(sessionId, client);
            });
        });
    }

    sendConnectionCount(connections) {

        this.updateChannel.send({
            event: 'sseConnections',
            data: { sseConnections: connections }
        });
    }

    static peerToAppPeer(peer) {

        return peer ? {
            peerId: peer.peerId,
            originPlatform: peer.originPlatform,
            //hostname: peer.networkChain[peer.networkChain.length-1].ip.hostname
            hostname: peer.ips ? peer.ips[0].hostname : ''
        } : {};
    }

    sendWebPeers() {

        const obj = Peers.strMapToObj(this.webPeers);
        this.emitter.emit('webPeers', obj);
    }

    static strMapToObj(strMap) {
        let obj = Object.create(null);
        for (let [k,v] of strMap) {
            obj[k] = v;
        }
        return obj;
    }
};