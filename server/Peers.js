const IpTranslator = require('./IpTranslator');
const _ = require('lodash');

module.exports = class Peers {

    constructor(updateChannel, remoteLog, app, emitter) {
        this.updateChannel = updateChannel;
        this.remoteLog = remoteLog;
        this.app = app;
        this.emitter = emitter;

        this.webPeers = new Map();
        IpTranslator.lookedUpIPs = new Map();
    }

    reset() {
        this.webPeers.clear();
    }

    create(peer) {

        //this.peerIdBySessionId.set(peer.sessionId, peer.peerId);
        this.webPeers.set(peer.peerId, peer);
        this.sendWebPeers('add', peer);
        return [...this.webPeers.values()];
    }

    update(request, response) {

        const peerId = request.params.peerId;
        const peer = this.webPeers.get(peerId);
        if(!peer) {

            return response.status(404).send('Peer not found');

        } else {

            const update = request.body;
            const peer = this.webPeers.get(peerId);
            _.merge(peer, update);
            this.sendWebPeers('update', peer);
            response.send(true);
        }
    }

    connect(sessionId) {
        //this.peerIdBySessionId.set(sessionId, sessionId);
    }

    disconnect(request) {
        const sessionId = request.query.sessionId;

        const peer = [...this.webPeers.values()].find(item => item.sessionId === sessionId);
        if(peer) {

            this.emitter.emit('removeOwner', peer.peerId);

            //this.emitter.emit('event', 'warning', 'peerDisconnect',
            //    Peers.peerToAppPeer(this.webPeers.get(peerId)));
            this.webPeers.delete(peer.peerId);
            this.sendWebPeers('delete', peer.peerId);
        }

        this.emitter.emit('disconnectPeer', sessionId);
    }

    sendWebPeers(type, item) {

        this.updateChannel.send({
            event: 'peers',
            data: {
                type: type,
                item: item
            }
        });
    }
};