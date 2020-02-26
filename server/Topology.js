
module.exports = class Topology {

    constructor(peers, updateChannel) {
        this.peers = peers;
        this.connectionsMap = new Map();
        this.updateChannel = updateChannel;
    }

    connect(connection) {

        const fromPeer = this.peers.webPeers.get(connection.fromPeerId);
        if(!fromPeer) return;
        let typeFrom = fromPeer.networkChain.find(item => item.ip === connection.from);
        const toPeer = this.peers.webPeers.get(connection.toPeerId);
        if(!toPeer) return;
        let typeTo;
        if(connection.to) {
            typeTo = toPeer.networkChain.find(item => item.ip === connection.to);
        } else if(!connection.to && typeFrom && typeFrom.type) {
            typeTo = toPeer.networkChain.find(item => item.type === typeFrom.type);
            connection.to = typeTo.ip;
            connection.toPort = typeTo.port;
        }

        if(!connection.from && !typeFrom && typeTo.type) {
            typeFrom = fromPeer.networkChain.find(item => item.type === typeTo.type);
            connection.from = typeFrom.ip;
            connection.fromPort = typeFrom.port;
        }
        if(typeFrom && typeTo) {
            if(typeFrom.typeDetail === 'host' && typeTo.typeDetail === 'host') {

                connection.connectionType = 'p2p';

            } else if(typeFrom.typeDetail === 'relay' || typeTo.typeDetail === 'relay') {

                connection.connectionType = this.addEmptySpaces(
                    [
                        'relay',
                        typeFrom.network.location ? typeFrom.network.location.country_flag_emoji : ''
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