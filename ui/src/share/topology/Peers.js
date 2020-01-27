import update from "immutability-helper";

export default class Peers {

    constructor(emitter, items, service) {

        this.items = items;
        this.service = service;

        emitter.on('peers', event => {

            if(event.type === 'add') {
                this.items = update(this.items, {$push: [event.item]});
            } else if(event.type === 'delete') {
                const index = this.items.findIndex(item => item.peerId === event.item);
                if(index > -1)
                    this.items = update(this.items, {$splice: [[index, 1]]});
            } else if(event.type === 'update') {
                const index = this.items.findIndex(item => item.peerId === event.item.peerId);
                if(index > -1)
                    this.items = update(this.items, {$splice: [[index, 1, event.item]]});
            }
            emitter.emit('numPeersChange', this.items.length);
        });

        emitter.on('peerConnections', connections => {
            this.connections = connections;
        });
    }

    connect(torrent, myPeerId) {

        if(!torrent._peers) return;

        const self = this;
        const infoHash = torrent.infoHash;
        const fileName = torrent.name;
        const peers = Object.values(torrent._peers).map(peer => {

            const conn = peer.conn;
            const peerId = conn.id;

            const result = {
                fileName: fileName,
                infoHash: infoHash,

                fromPeerId: peerId,
                from: conn.remoteAddress,
                fromPort: conn.remotePort,
                remoteFamily: conn.remoteFamily,

                toPeerId: myPeerId,
                to: conn.localAddress,
                toPort: conn.localPort,
                localFamily: conn.localFamily
            };

            self.service.connect(result);

            return result;
        });

        return peers;
    }

    disconnect(infoHash) {

        this.service.disconnect(infoHash);
    }
}