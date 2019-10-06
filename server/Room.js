//----------------Domain - Content rooms
const ServerPeer = require('./ServerPeer');
const Peers = require('./Peers');
const IpTranslator = require('./IpTranslator');
const magnet = require('magnet-uri');

module.exports = class Room {

    constructor(updateChannel, remoteLog, app, emitter, peers, ice) {
        this.updateChannel = updateChannel;
        this.remoteLog = remoteLog;
        this.app = app;
        this.emitter = emitter;
        this.peers = peers;

        this.serverPeer = new ServerPeer(updateChannel, remoteLog, app, peers, this, ice, emitter);

        this.urls = [];

        //dispatched by Peer
        emitter.on('removeOwner', (peerId) => {
            this.removeOwner(peerId);
        });
    }

    start() {

        this.registerRoomRoutes(this.app);
        this.registerOwnerRoutes(this.app);
        this.registerConnectionRoutes(this.app);
    }

    reset() {
        this.urls = [];
        IpTranslator.reset();
        this.serverPeer.reset();
        this.peers.reset();
    }

    registerRoomRoutes(app) {
        const urls = this.urls;

        app.get('/api/rooms', (request, response) => {
            response.send({'1': urls});
        });

        app.delete('/api/rooms', (request, response) => {
            this.reset();
            response.send(urls);
        });

        app.get('/api/rooms/1', (request, response) => {

            response.send(urls);
        });

        app.delete('/api/rooms/1', (request, response) => {
            const hash = request.body.hash;
            const origin = request.body.origin;

            let found = undefined;
            if (hash) {
                this.serverPeer.removeTorrent(hash);
                found = urls.find((item, index) => {
                    if (item.hash === hash) {

                        const parsed = magnet(item.url);
                        const event = Peers.peerToAppPeer(item.sharedBy);
                        event.file = parsed.dn;
                        event.origin = origin;
                        this.emitter.emit('event', 'warning', 'picRemove', event);

                        urls.splice(index, 1);
                        return true;
                    }
                    return false;
                });

                if (found) {
                    this.updateChannel.send({
                        event: 'urls',
                        data: { urls: urls }
                    });
                }
            }
            response.send([found]);
        });

        //let wtServer;
        app.post('/api/rooms/1', (request, response) => {

            const url = request.body.url;
            const serverPeer = request.body.serverPeer;

            if(serverPeer && url) {

                this.serverPeer.start(url, request, response);

            } else {
                const hash = request.body.hash;
                const secure = request.body.secure;
                const peerId = request.body.peerId;
                const origin = request.body.origin;
                const fileSize = request.body.fileSize;

                if(!peerId) {
                    response.status(400).send();
                    return;
                }

                let urlItem;
                if (url) {
                    urlItem = this.findUrl(url);
                    if (!urlItem) {
                        const peer = this.peers.webPeers.get(peerId);
                        if(!peer) {
                            this.remoteLog('add url: no webPeer for ' + hash);
                            response.status(500).send();
                            return;
                        }
                        urlItem = {hash: hash, url: url, secure: secure,
                            sharedBy: peer, owners: [], fileSize: fileSize};
                        urls.push(urlItem);

                        const parsed = magnet(url);
                        const event = Peers.peerToAppPeer(peer);
                        event.file = parsed.dn;
                        event.origin = origin;
                        this.emitter.emit('event', 'info', 'picAdd', event);
                    }
                }
                this.addOwner(urlItem.hash, peerId);
                /*
                this.updateChannel.send({
                    event: 'urls',
                    data: { urls: urls }
                });
                */

                response.send(urlItem);
            }
        });

        /*
        app.get('/api/rooms/1/files/:index', (request, response) => {

            if(webtorrent.client && webtorrent.client.torrents.length > 0) {

                const index = request.params.index;
                if(webtorrent.client.torrents[index]) {
                    const torrent = webtorrent.client.torrents[index];
                    const file = torrent.files[0];
                    const torrentFile = torrent.torrentFile;

                    //response.set('Content-Type', 'image/png');
                    //response.sendFile(torrentFile);

                    const encodedBuffer = torrentFile.toString('base64');
                    response.send(encodedBuffer);
                } else {
                    response.status(404).send();
                }
            } else {
                response.status(404).send();
            }
        });
        */

    }


    findUrl(url) {
        return this.findByField('url', url);
    }

    findByField(field, value) {
        const index = this.urls.findIndex(item => item[field] === value);
        let foundItem = null;
        if(index => 0) {
            foundItem = this.urls[index];
        }
        return foundItem;
    }

    registerOwnerRoutes(app) {
        app.post('/api/rooms/1/owners', (request, response) => {

            const owner = {
                channel: '1',
                infoHash: request.body.infoHash,
                peerId: request.body.peerId
            };

            owner.platform = this.addOwner(owner.infoHash, owner.peerId);

            response.send(owner);
        });

        app.delete('/api/rooms/1/owners', (request, response) => {

            const owner = {
                channel: '1',
                infoHash: request.body.infoHash,
                peerId: request.body.peerId
            };

            this.urls.find(item => {
                if(item.hash === owner.infoHash) {
                    this.removeOwner(owner.peerId);
                    return true;
                } else {
                    return false;
                }
            });

            response.send(owner)
        });
    }

    addOwner(infoHash, peerId) {

        let platform = '';
        this.urls.find(item => {
            if(item.hash === infoHash) {
                const peer = this.peers.webPeers.get(peerId);
                //TODO, add pg to peer.
                platform = peer ? peer.originPlatform : 'photogroup.network';
                const found = item.owners.find(item => item.peerId === peerId);
                if(!found) {
                    item.owners.push({
                        platform: platform,
                        peerId: peerId
                    });
                }
                return true;
            } else {
                return false;
            }
        });

        this.updateChannel.send({
            event: 'urls',
            data: { urls: this.urls }
        });

        return platform;
    }

    removeOwner(peerId) {
        this.urls.forEach(item => {
            const index = item.owners.findIndex(owner => owner.peerId === peerId);
            if(index >= 0) {
                item.owners.splice(index, 1);

                if(this.serverPeer.hasPeerId(peerId)) {
                    this.serverPeer.removeTorrent(item.hash);
                }
            }
        });

        this.updateChannel.send({
            event: 'urls',
            data: { urls: this.urls }
        });
    }

    registerConnectionRoutes(app) {
        app.post('/api/rooms/1/connections', (request, response) => {

            const connection = {
                channel: '1',
                from: request.body.from,
                to: request.body.to,
                arrows: request.body.arrows,
                label: request.body.label,
                infoHash: request.body.infoHash,
                fromAddr: request.body.fromAddr,
                toAddr: request.body.toAddr
            };

            this.emitter.emit('connectNode', connection);

            response.send(connection)
        });

        app.delete('/api/rooms/1/connections', (request, response) => {

            const hash = request.body.hash;

            this.emitter.emit('disconnectNode', hash);

            response.send(hash)
        });
    }
};