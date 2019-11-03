//-------------------Web Peers

const IpTranslator = require('./IpTranslator');
const Tracker = require('./Tracker');
const Topology = require('./Topology');

module.exports = class Peers {

    constructor(updateChannel, remoteLog, app, emitter) {
        this.updateChannel = updateChannel;
        this.remoteLog = remoteLog;
        this.app = app;
        this.emitter = emitter;

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

                peer.originPlatform = request.body.originPlatform;
                peer.ips = ips.map(ip => IpTranslator.createEmptyIpObj(ip))

                this.webPeers.set(peer.peerId, peer);

                Promise.all(ips
                    .map(ip => IpTranslator.getLookupIp(ip)))
                    .then(results => peer.ips = results)
                    .then(results => {

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

                this.emitter.emit('event', 'warning', 'peerDisconnect', Peers.peerToAppPeer(this.webPeers.get(peerId)));
                this.webPeers.delete(peerId);
                this.sendWebPeers();
            }

            this.peerIdBySessionId.delete(sessionId);

            this.sendConnectionCount(channel.connectionCount);
        });

        this.app.get('/api/updates/', (request, response) => {

            response.header('X-Accel-Buffering', 'no');
            this.updateChannel.addClient(request, response);
        });
    }

    sendConnectionCount(connections) {

        this.updateChannel.send({
            event: 'sseConnections',
            data: { sseConnections: connections }
        });
    }

    static peerToAppPeer(peer) {

        return {
            peerId: peer.peerId,
            originPlatform: peer.originPlatform,
            //hostname: peer.networkChain[peer.networkChain.length-1].ip.hostname
            hostname: peer.ips[0].hostname
        }
    }

    sendWebPeers() {

        const obj = Peers.strMapToObj(this.webPeers);

        this.emitter.emit('webPeers', obj);

        this.updateChannel.send({
            event: 'webPeers',
            data: obj
        });
    }

    static strMapToObj(strMap) {
        let obj = Object.create(null);
        for (let [k,v] of strMap) {
            obj[k] = v;
        }
        return obj;
    }
};