import IpTranslator from './IpTranslator.js';
import _ from 'lodash';

export default class Peers {

    constructor(updateChannel, remoteLog, app, emitter) {
        this.updateChannel = updateChannel;
        this.remoteLog = remoteLog;
        this.app = app;
        this.emitter = emitter;

        this.webPeers = new Map();
        this.clientsBySessionId = new Map();

        emitter.on('iceEvent', event => {

            this.buildIceEvent(event);
        });
    }

    reset() {
        this.webPeers.clear();
        this.clientsBySessionId.clear();
    }

    get peers() {
        return [...this.webPeers.values()];
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
        return this.peers;
    }

    update(request, response, room) {

        const peerId = request.params.peerId;
        const update = request.body;
        const peer = this.webPeers.get(peerId);
        if(!peer) {

            if(update.peerId && update.sessionId && update.originPlatform) {

                const peers = this.createPeer(peerId, update);
                response.send({
                    photos: room.photos,
                    peers: peers,
                });

            } else {

                return response.status(404).send('Peer not found');
            }

        } else {

            this.updatePeer(peer, update);
            response.send(true);
        }
    }

    updatePeer(peer, update) {
        const newPeer = _.merge(peer, update);
        this.webPeers.set(peer.peerId, newPeer);
        this.sendWebPeers('update', newPeer);
        IpTranslator.enrichNetworkChainIPs(newPeer.networkChain).then(results => {
            if(results && results.length > 0) {
                this.sendWebPeers('update', newPeer);
            }
        });
    }

    createPeer(peerId, update) {
        this.webPeers.set(peerId, update);
        this.sendWebPeers('add', update);
        if(update.networkChain) {
            IpTranslator.enrichNetworkChainIPs(update.networkChain).then(results => {
                if(results && results.length > 0) {
                    this.sendWebPeers('update', update);
                }
            });
        }
        return this.peers;
    }

    connect(sessionId) {
        //this.peerIdBySessionId.set(sessionId, sessionId);
    }

    disconnect(request) {
        const sessionId = request.query.sessionId;
        this.clientsBySessionId.delete(sessionId);

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

        const clients = [...this.clientsBySessionId.values()];
        this.updateChannel.send({
            event: 'peers',
            data: {
                type: type,
                item: item
            }
        }, clients);
    }

    buildIceEvent(event) {

        if(event.type === 'iceOffer') {

            //console.log(event.type + ' ' + event.sharedBy + ' ' + event.sdp.length);

            const peer = this.webPeers.get(event.sharedBy);
            if(peer && peer.networkChain) {
                let foundAny;
                
                // For relay entries, replace old ones instead of accumulating
                // Keep only the most recent relay entries from this offer
                const newRelayIps = event.sdp.filter(s => s.typeDetail === 'relay').map(s => s.ip);
                if (newRelayIps.length > 0) {
                    // Remove old relay entries that aren't in the new offer
                    peer.networkChain = peer.networkChain.filter(item => 
                        item.typeDetail !== 'relay' || newRelayIps.includes(item.ip)
                    );
                }
                
                event.sdp.forEach(sdp => {
                    const found = peer.networkChain.find(item => item.ip === sdp.ip);
                    if(!found) {
                        peer.networkChain.push(sdp);
                        foundAny = true;
                    }
                });
                if(foundAny) {
                    // Enrich new network chain items with IP translation
                    IpTranslator.enrichNetworkChainIPs(peer.networkChain).then(results => {
                        if(results && results.length > 0) {
                            this.sendWebPeers('update', peer);
                        }
                    });
                }
            }

        } else if(event.type === 'iceAnswer' && event.event === 'update') {

            console.log(event.type)

        } else if(event.event === 'completed' || event.event === 'stopped') {

            console.log('other event ' + event.event)
        }
    }
};