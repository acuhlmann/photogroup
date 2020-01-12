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

        emitter.on('iceEvent', event => {

            this.buildIceEvent(event);
        });
    }

    reset() {
        this.webPeers.clear();
    }

    create(peer) {

        if(!peer.networkChain) {
            peer.networkChain = [];
        }
        this.webPeers.set(peer.peerId, peer);
        this.sendWebPeers('add', peer);
        IpTranslator.enrichNetworkChainIPs(peer.networkChain).then(results => {
            if(results && results.length > 0) {
                this.sendWebPeers('update', peer);
            }
        });
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
            const newPeer = _.merge(peer, update);
            this.webPeers.set(peer.peerId, newPeer);
            this.sendWebPeers('update', newPeer);
            IpTranslator.enrichNetworkChainIPs(newPeer.networkChain).then(results => {
                if(results && results.length > 0) {
                    this.sendWebPeers('update', newPeer);
                }
            });
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

    buildIceEvent(event) {

        let chain, peerId;
        if(event.type === 'iceOffer') {

            console.log(event.type)

            return;
            const peer = this.webPeers.set(event.sharedBy);
            if(peer && peer.network) {
                //_.merge(peer.network, event.sdp);

                /*const hosts = event.sdp.filter(item => item.type === 'host');
                const host = peer.network.find(item => item.type === 'host' && item.label);
                const ip = host.ip;
                _.merge(host, hosts);
                host.ip = ip;*/

                const relays = event.sdp.filter(item => item.type === 'relay');
                const relay = peer.network.find(item => item.type === 'relay');
                if(relay) {
                    _.merge(relay, relays);
                }
                console.log('foo')
            }
            //this.webPeers.set(event.sharedBy, newPeer);

        } else if(event.type === 'iceAnswer' && event.event === 'update') {

            console.log(event.type)

        } else if(event.event === 'completed' || event.event === 'stopped') {
            console.log('other event ' + event.event)
        }
    }
};