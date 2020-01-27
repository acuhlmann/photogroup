const IpTranslator = require('./IpTranslator');

module.exports = class Topology {

    constructor(peers, updateChannel) {
        this.peers = peers;
        this.connectionsMap = new Map();
        this.updateChannel = updateChannel;
    }

    connect(connection) {

        const fromPeer = this.peers.webPeers.get(connection.fromPeerId);
        const typeFrom = fromPeer.networkChain.find(item => item.ip === connection.from);
        const toPeer = this.peers.webPeers.get(connection.toPeerId);
        const typeTo = toPeer.networkChain.find(item => item.ip === connection.to);
        if(typeFrom && typeTo) {
            if(typeFrom.typeDetail === 'host' && typeTo.typeDetail === 'host') {
                connection.connectionType = 'p2p';
            } else if(typeFrom.typeDetail === 'relay' || typeTo.typeDetail === 'relay') {
                connection.connectionType = 'relay' + this.addEmptySpaces(
                    [typeFrom.network.location ? typeFrom.network.location.country_flag_emoji : '']);
            } else {
                connection.connectionType = 'p2p nat';
            }
        }
        this.connectionsMap.set(connection.to + '-' + connection.from + '-' + connection.infoHash, connection);
        this.sendConnections();
    }

    addEmptySpaces(values) {
        return values.map(value => value && value !== null ? value + ' ' : '').join('');
    }

    disconnect(infoHash) {

        this.connections.forEach(item => {
            if(item.infoHash === infoHash) {
                this.connectionsMap.delete(item.to + '-' + item.from + '-' + infoHash);
            }
        });

        this.sendConnections();
    }

    get connections() {
        return Array.from(this.connectionsMap).map(item => item[1]);
    }

    sendConnections() {

        this.updateChannel.send({
            event: 'peerConnections',
            data: this.connections
        });
    }
};