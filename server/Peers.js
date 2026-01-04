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
        console.log(`[Peers] create: peer ${peer.peerId} with ${peer.networkChain?.length || 0} networkChain items`);
        // Initialize network property for all chain items immediately
        // This ensures the UI has the structure even before enrichment completes
        peer.networkChain.forEach(item => {
            if (item && item.ip && !item.network) {
                item.network = IpTranslator.createEmptyIpObj(item.ip);
            }
        });
        this.webPeers.set(peer.peerId, peer);
        this.sendWebPeers('add', peer);
        // Enrich asynchronously and send update when complete
        IpTranslator.enrichNetworkChainIPs(peer.networkChain).then(results => {
            console.log(`[Peers] create: enrichment completed for peer ${peer.peerId}, sending update`);
            if(results && results.length > 0) {
                this.sendWebPeers('update', peer);
            }
        }).catch(err => {
            console.error(`[Peers] create: enrichment failed for peer ${peer.peerId}:`, err);
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
        // Initialize network property for any new chain items
        if(newPeer.networkChain) {
            newPeer.networkChain.forEach(item => {
                if (item && item.ip && !item.network) {
                    item.network = IpTranslator.createEmptyIpObj(item.ip);
                }
            });
        }
        this.webPeers.set(peer.peerId, newPeer);
        this.sendWebPeers('update', newPeer);
        // Enrich asynchronously and send update when complete
        if(newPeer.networkChain) {
            IpTranslator.enrichNetworkChainIPs(newPeer.networkChain).then(results => {
                if(results && results.length > 0) {
                    this.sendWebPeers('update', newPeer);
                }
            });
        }
    }

    createPeer(peerId, update) {
        // Initialize network property for all chain items immediately
        if(update.networkChain) {
            update.networkChain.forEach(item => {
                if (item && item.ip && !item.network) {
                    item.network = IpTranslator.createEmptyIpObj(item.ip);
                }
            });
        }
        this.webPeers.set(peerId, update);
        this.sendWebPeers('add', update);
        if(update.networkChain) {
            // Enrich asynchronously and send update when complete
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
        // Always log what we're sending (not just in debug mode)
        if (item.networkChain && item.networkChain.length > 0) {
            const enrichedItems = item.networkChain.filter(chainItem => chainItem.network && (chainItem.network.city || chainItem.network.connection?.isp));
            if (enrichedItems.length > 0) {
                console.log(`[Peers] Sending ${type} for peer ${item.peerId} with ${enrichedItems.length}/${item.networkChain.length} enriched network items`);
                enrichedItems.forEach(chainItem => {
                    console.log(`  ✓ ${chainItem.ip}: ${chainItem.network.city || ''} ${chainItem.network.connection?.isp || ''}`);
                });
            } else {
                console.log(`[Peers] Sending ${type} for peer ${item.peerId} - ${item.networkChain.length} networkChain items but NO enriched data`);
                item.networkChain.forEach(chainItem => {
                    const hasNetwork = !!chainItem.network;
                    const networkInfo = hasNetwork ? `network exists but no city/isp` : `no network property`;
                    console.log(`  - ${chainItem.ip}: ${networkInfo}`);
                });
            }
        } else {
            console.log(`[Peers] Sending ${type} for peer ${item.peerId} - no networkChain`);
        }

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