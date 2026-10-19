import IpTranslator from './IpTranslator.js';
import { randomUUID } from 'node:crypto';
import _ from 'lodash';

// Phones drop their update stream on every screen lock, tab switch or network
// handover and reopen it moments later; only a session that stays away this
// long has left the room.
const LEAVE_GRACE_MS = 10000;

export default class Peers {

    constructor(updateChannel, remoteLog, app, emitter, { leaveGraceMs = LEAVE_GRACE_MS } = {}) {
        this.updateChannel = updateChannel;
        this.remoteLog = remoteLog;
        this.app = app;
        this.emitter = emitter;
        this.leaveGraceMs = leaveGraceMs;

        this.webPeers = new Map();
        this.clientsBySessionId = new Map();
        this.leaveTimers = new Map();
        // sessionId -> secret proving a request comes from that session's tab.
        // sessionIds are broadcast with every peer, so they can't authorize
        // evicting or removing a peer on their own.
        this.sessionTokens = new Map();

        emitter.on('iceEvent', event => {

            this.buildIceEvent(event);
        });
    }

    reset() {
        this.webPeers.clear();
        this.clientsBySessionId.clear();
        this.leaveTimers.forEach(timer => clearTimeout(timer));
        this.leaveTimers.clear();
        this.sessionTokens.clear();
    }

    get peers() {
        return [...this.webPeers.values()];
    }

    // Returns the session's token when the caller owns the session (a first
    // join, or a reload presenting the token it was given), otherwise null.
    claimSession(sessionId, token) {
        if(typeof sessionId !== 'string' || !sessionId) return null;
        const known = this.sessionTokens.get(sessionId);
        if(!known) {
            const issued = randomUUID();
            this.sessionTokens.set(sessionId, issued);
            return issued;
        }
        return token === known ? known : null;
    }

    create(peer, ownsSession = false) {

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
        if(ownsSession) {
            this.replaceSession(peer);
        }
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

    // A reloaded tab keeps its sessionId but WebTorrent hands it a fresh
    // peerId. Behind the wake proxy the old page's stream close can take ages
    // to reach us, so drop the old peer as soon as its replacement joins, and
    // cancel the old stream's pending leave so it can't remove the new peer.
    replaceSession(peer) {
        clearTimeout(this.leaveTimers.get(peer.sessionId));
        this.leaveTimers.delete(peer.sessionId);
        this.peers
            .filter(item => item.sessionId === peer.sessionId && item.peerId !== peer.peerId)
            .forEach(item => this.removePeer(item));
    }

    removePeer(peer) {
        this.emitter.emit('removeOwner', peer.peerId);
        this.webPeers.delete(peer.peerId);
        this.sendWebPeers('delete', peer.peerId);
    }

    // Sent by a closing tab (sendBeacon on pagehide). Keyed by peerId so a
    // late beacon from a reloaded page can't remove the page that replaced it.
    leaveNow(sessionId, peerId, token) {
        const peer = this.webPeers.get(peerId);
        if(!peer || peer.sessionId !== sessionId) return false;
        if(!token || this.sessionTokens.get(sessionId) !== token) return false;
        this.removePeer(peer);
        return true;
    }

    connect(sessionId) {
        //this.peerIdBySessionId.set(sessionId, sessionId);
    }

    disconnect(request, response) {
        const sessionId = request.query.sessionId;
        // A resuming phone opens its new stream before the old one's close
        // reaches us; only the session's current stream counts.
        if(response && this.clientsBySessionId.get(sessionId) !== response) return;
        this.clientsBySessionId.delete(sessionId);

        clearTimeout(this.leaveTimers.get(sessionId));
        const timer = setTimeout(() => this.leave(sessionId), this.leaveGraceMs);
        timer.unref?.();
        this.leaveTimers.set(sessionId, timer);
    }

    leave(sessionId) {
        this.leaveTimers.delete(sessionId);
        if(this.clientsBySessionId.has(sessionId)) return; // came back in time
        this.sessionTokens.delete(sessionId);

        const peer = [...this.webPeers.values()].find(item => item.sessionId === sessionId);
        if(peer) {
            this.removePeer(peer);
        }

        this.emitter.emit('disconnectPeer', sessionId);
    }

    sendWebPeers(type, item) {
        // For delete events, item is a peerId string, not a peer object
        const peerId = typeof item === 'string' ? item : item.peerId;

        if (typeof item !== 'string' && item.networkChain && item.networkChain.length > 0) {
            const enrichedItems = item.networkChain.filter(chainItem => chainItem.network && (chainItem.network.city || chainItem.network.connection?.isp));
            if (enrichedItems.length > 0) {
                console.log(`[Peers] Sending ${type} for peer ${peerId} with ${enrichedItems.length}/${item.networkChain.length} enriched network items`);
                enrichedItems.forEach(chainItem => {
                    console.log(`  ✓ ${chainItem.ip}: ${chainItem.network.city || ''} ${chainItem.network.connection?.isp || ''}`);
                });
            } else {
                console.log(`[Peers] Sending ${type} for peer ${peerId} - ${item.networkChain.length} networkChain items but NO enriched data`);
                item.networkChain.forEach(chainItem => {
                    const hasNetwork = !!chainItem.network;
                    const networkInfo = hasNetwork ? `network exists but no city/isp` : `no network property`;
                    console.log(`  - ${chainItem.ip}: ${networkInfo}`);
                });
            }
        } else {
            console.log(`[Peers] Sending ${type} for peer ${peerId}`);
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