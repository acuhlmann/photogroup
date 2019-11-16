//----------------Domain - Content rooms
const ServerPeer = require('./ServerPeer');
const Peers = require('./Peers');
const magnet = require('magnet-uri');
const _ = require('lodash');

module.exports = class Room {

    constructor(updateChannel, remoteLog, app, emitter, peers, ice) {
        this.updateChannel = updateChannel;
        this.remoteLog = remoteLog;
        this.app = app;
        this.emitter = emitter;
        this.peers = peers;
        this.ice = ice;

        this.rooms = new Map();

        //dispatched by Peers when someone disconnects, need to remove all ownerships.
        emitter.on('removeOwner', (peerId) => {

            Object.values(this.rooms).forEach(room => {
                this.removeOwner(room, peerId);
            });
        });
    }

    start(initFunction) {
        this.initFunction = initFunction;
        this.registerRoomRoutes(this.app);
        this.registerOwnerRoutes(this.app);
        this.registerConnectionRoutes(this.app);
    }

    reset() {
        this.rooms.clear();
        this.peers.reset();
    }

    registerRoomRoutes(app) {
        const rooms = this.rooms;

        app.delete('/api/rooms', (request, response) => {
            this.reset();
            response.send({message: 'success'});
        });

        app.post('/api/rooms/', (request, response) => {

            const id = request.body.id;
            const room = {
                id: id,
                clientsByRooms: new Map(),
                urls: [],
                serverPeer: new ServerPeer(this.remoteLog, this.peers, this, this.ice, this.emitter)
            };
            room.clientsByRooms.set(id, []);

            rooms.set(id, room);
            response.send({
                urls: room.urls
            });
        });

        app.get('/api/rooms/:id', (request, response) => {

            const id = request.params.id;
            const room = rooms.get(id);
            if(room) {
                const sessionId = request.query.sessionId;
                if(sessionId) {
                    const client = this.peers.clientsBySessionId.get(sessionId);
                    const clients = room.clientsByRooms.get(id);
                    if(!clients.find(item => item.req.query.sessionId === client.req.query.sessionId)) {
                        clients.push(client);
                    }
                }

                response.send({
                    urls: room.urls
                });

            } else {

                response.status(404).send('Room not found');
            }
        });

        app.delete('/api/rooms/:id', (request, response) => {

            const id = request.params.id;
            const room = rooms.get(id);
            if(room) {

                const hash = request.body.hash;
                const origin = request.body.origin;

                let found = undefined;
                if (hash) {
                    room.serverPeer.removeTorrent(hash);
                    found = room.urls.find((item, index) => {
                        if (item.hash === hash) {

                            const parsed = magnet(item.url);
                            const event = Peers.peerToAppPeer(item.sharedBy);
                            event.file = parsed.dn;
                            event.origin = origin;
                            this.emitter.emit('event', 'warning', 'picRemove', event);

                            room.urls.splice(index, 1);
                            return true;
                        }
                        return false;
                    });

                    if (found) {
                        this.sendUrls(room);
                    }
                }
                response.send([found]);

            } else {
                response.status(404).send('Room not found');
            }
        });

        app.post('/api/rooms/:id/photos', (request, response) => {

            const id = request.params.id;
            const room = rooms.get(id);
            if(!room) {

                return response.status(404).send('Room not found');

            } else {

                const url = request.body.url;
                const hash = request.body.hash;

                const serverPeer = request.body.serverPeer;

                if(serverPeer && url) {

                    this.room.serverPeer.start(room, url, request, response);

                } else {
                    const peerId = request.body.peerId;
                    const origin = request.body.origin;

                    if(!peerId) {
                        response.status(400).send();
                        return;
                    }

                    let urlItem;
                    if (url) {
                        urlItem = this.findUrl(room.urls, hash);
                        if (!urlItem) {
                            const peer = this.peers.webPeers.get(peerId);
                            if(!peer) {
                                this.remoteLog('add url: no webPeer for ' + hash);
                                response.status(500).send();
                                return;
                            }
                            urlItem = request.body;
                            urlItem.owners = [];
                            urlItem.sharedBy = peer;

                            room.urls.push(urlItem);

                            const parsed = magnet(url);
                            const event = Peers.peerToAppPeer(peer);
                            event.file = parsed.dn;
                            event.origin = origin;
                            this.emitter.emit('event', 'info', 'picAdd', event);
                        }
                    }
                    this.addOwner(room, urlItem.hash, peerId);

                    response.send(urlItem);
                }
            }
        });

        app.put('/api/rooms/:id/photos/', (request, response) => {

            const id = request.params.id;
            const room = rooms.get(id);
            if(!room) {

                return response.status(404).send('Room not found');

            } else {

                const hash = request.body.hash;
                const existingUrl = this.findUrl(room.urls, hash);
                const newUrl = request.body;
                _.merge(existingUrl, newUrl);
                existingUrl.picSummary = this.createPicSummary(existingUrl);
                this.sendUrls(room);
                response.send(existingUrl);
            }
        });
    }

    createPicSummary(url) {
        return url.picDateTaken + ' ' + url.picTitle
            + ' ' + url.picDesc + url.fileName;
    }

    findUrl(urls, hash) {
        return this.findByField(urls, 'hash', hash);
    }

    findByField(urls, field, value) {
        const index = urls.findIndex(item => item[field] === value);
        let foundItem = null;
        if(index => 0) {
            foundItem = urls[index];
        }
        return foundItem;
    }

    registerOwnerRoutes(app) {
        app.post('/api/rooms/:id/photos/owners', (request, response) => {

            const id = request.params.id;
            const room = this.rooms.get(id);
            if(!room) {

                return response.status(404).send('Room not found');

            } else {

                const owner = {
                    infoHash: request.body.infoHash,
                    peerId: request.body.peerId
                };

                owner.platform = this.addOwner(room, owner.infoHash, owner.peerId);

                response.send(owner);
            }
        });

        app.delete('/api/rooms/:id/photos/owners', (request, response) => {

            const room = this.rooms.get(request.params.id);
            if(!room) {

                return response.status(404).send('Room not found');

            } else {

                const owner = {
                    infoHash: request.body.infoHash,
                    peerId: request.body.peerId
                };

                room.urls.find(item => {
                    if(item.hash === owner.infoHash) {
                        this.removeOwner(room, owner.peerId);
                        return true;
                    } else {
                        return false;
                    }
                });

                response.send(owner)
            }
        });
    }

    addOwner(room, infoHash, peerId) {

        let platform = '';
        room.urls.find(item => {
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

        this.sendUrls(room);

        return platform;
    }

    removeOwner(room, peerId) {
        room.urls.forEach(item => {
            const index = item.owners.findIndex(owner => owner.peerId === peerId);
            if(index >= 0) {
                item.owners.splice(index, 1);

                if(room.serverPeer.hasPeerId(peerId)) {
                    room.serverPeer.removeTorrent(item.hash);
                }
            }
        });

        this.sendUrls(room);
    }

    registerConnectionRoutes(app) {
        app.post('/api/rooms/:id/photos/connections', (request, response) => {

            const connection = {
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

        app.delete('/api/rooms/:id/photos/connections', (request, response) => {

            const hash = request.body.hash;

            this.emitter.emit('disconnectNode', hash);

            response.send(hash)
        });
    }

    sendUrls(room) {
        const clients = room.clientsByRooms.get(room.id);
        this.updateChannel.send({
            event: 'urls',
            data: { urls: room.urls }
        }, clients);
    }
};