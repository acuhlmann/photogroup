export default class Topology {

    constructor(peers, updateChannel) {
        this.peers = peers;
        this.connectionsMap = new Map();
        this.updateChannel = updateChannel;
    }

    connect(connection) {
        const fromPeer = this.peers.webPeers.get(connection.fromPeerId);
        if(!fromPeer) return;
        
        const toPeer = this.peers.webPeers.get(connection.toPeerId);
        if(!toPeer) return;
        
        // For WebRTC connections, we may not have IP addresses
        // Try to infer connection type from the peers' network chains
        let typeFrom = null;
        let typeTo = null;
        
        // First, try exact IP match if we have IPs
        if (connection.from) {
            typeFrom = fromPeer.networkChain?.find(item => item.ip === connection.from);
            // Fallback to host type for local/private IPs
            if (!typeFrom) {
                const isLocalIp = connection.from.startsWith('127.') || 
                                  connection.from.startsWith('192.168.') || 
                                  connection.from.startsWith('10.') ||
                                  connection.from.startsWith('172.');
                if (isLocalIp) {
                    typeFrom = fromPeer.networkChain?.find(item => item.typeDetail === 'host');
                }
            }
        }
        
        if (connection.to) {
            typeTo = toPeer.networkChain?.find(item => item.ip === connection.to);
            // Fallback to host type for local/private IPs
            if (!typeTo) {
                const isLocalIp = connection.to.startsWith('127.') || 
                                  connection.to.startsWith('192.168.') || 
                                  connection.to.startsWith('10.') ||
                                  connection.to.startsWith('172.');
                if (isLocalIp) {
                    typeTo = toPeer.networkChain?.find(item => item.typeDetail === 'host');
                }
            }
        }
        
        // If we still don't have typeFrom/typeTo, infer from the other's type
        if (!typeFrom && typeTo?.type) {
            typeFrom = fromPeer.networkChain?.find(item => item.type === typeTo.type);
            if (typeFrom) {
                connection.from = typeFrom.ip;
                connection.fromPort = typeFrom.port;
            }
        }
        
        if (!typeTo && typeFrom?.type) {
            typeTo = toPeer.networkChain?.find(item => item.type === typeFrom.type);
            if (typeTo) {
                connection.to = typeTo.ip;
                connection.toPort = typeTo.port;
            }
        }
        
        // For WebRTC connections without any IP info, use the best available network entry
        // Prefer: host > srflx > relay (most direct connection type available)
        if (!typeFrom && fromPeer.networkChain?.length > 0) {
            typeFrom = fromPeer.networkChain.find(item => item.typeDetail === 'host') ||
                       fromPeer.networkChain.find(item => item.typeDetail === 'srflx') ||
                       fromPeer.networkChain[0];
            if (typeFrom) {
                connection.from = typeFrom.ip;
                connection.fromPort = typeFrom.port;
            }
        }
        
        if (!typeTo && toPeer.networkChain?.length > 0) {
            // Match by same type if possible
            if (typeFrom?.typeDetail) {
                typeTo = toPeer.networkChain.find(item => item.typeDetail === typeFrom.typeDetail);
            }
            if (!typeTo) {
                typeTo = toPeer.networkChain.find(item => item.typeDetail === 'host') ||
                         toPeer.networkChain.find(item => item.typeDetail === 'srflx') ||
                         toPeer.networkChain[0];
            }
            if (typeTo) {
                connection.to = typeTo.ip;
                connection.toPort = typeTo.port;
            }
        }
        
        if(typeFrom && typeTo) {
            if(typeFrom.typeDetail === 'host' && typeTo.typeDetail === 'host') {
                connection.connectionType = 'p2p';
            } else if(typeFrom.typeDetail === 'relay' || typeTo.typeDetail === 'relay') {
                connection.connectionType = this.addEmptySpaces(
                    [
                        'relay',
                        typeFrom.network?.location?.country_flag_emoji || ''
                    ]);
            } else {
                connection.connectionType = 'p2p nat';
            }
            const id = connection.from + ':' + connection.fromPort + '-'
                + connection.to + ':' + connection.toPort + '-' + connection.infoHash;
            connection.id = id;
            this.connectionsMap.set(id, connection);
            this.sendConnections();
        }
    }

    addEmptySpaces(values) {
        return values.map(value => value && value !== null ? value + ' ' : '').join('');
    }

    disconnect(infoHash) {

        this.connections.forEach(connection => {
            if(connection.infoHash === infoHash) {
                const id = connection.from + ':' + connection.fromPort + '-'
                    + connection.to + ':' + connection.toPort + '-' + connection.infoHash;
                this.connectionsMap.delete(id);
            }
        });

        this.sendConnections();
    }

    get connections() {
        return Array.from(this.connectionsMap).map(item => item[1]);
    }

    sendConnections() {

        const clients = [...this.peers.clientsBySessionId.values()];
        this.updateChannel.send({
            event: 'peerConnections',
            data: this.connections
        }, clients);
    }
};