//----------------Domain - Content rooms
const ServerPeer = require('./ServerPeer');
const Topology = require('./Topology');
const Peers = require('./Peers');
const MyDht = require('./MyDht');
const _ = require('lodash');

module.exports = class Rooms {

    constructor(updateChannel, remoteLog, app, emitter, ice, tracker) {
        this.updateChannel = updateChannel;
        this.remoteLog = remoteLog;
        this.app = app;
        this.emitter = emitter;
        this.ice = ice;
        this.tracker = tracker;

        this.rooms = new Map();
        //this.dht = new MyDht();
        //this.dht.start();

        //dispatched by Peers when someone disconnects, need to remove all ownerships.
        emitter.on('removeOwner', (peerId) => {

            [...this.rooms.values()].forEach(room => {
                this.removeOwner(room, peerId);
            });
        });
    }

    start() {
        this.setupSSE();
        this.registerRoomRoutes(this.app);
        this.registerPeerRoutes(this.app);
        this.registerOwnerRoutes(this.app);
        this.registerConnectionRoutes(this.app);
    }

    reset() {
        this.rooms.clear();
    }

    registerRoomRoutes(app) {
        const rooms = this.rooms;

        app.delete('/api/rooms', (request, response) => {
            this.reset();
            response.send({message: 'success'});
        });

        function joinRoom(room, request, response) {
            const peers = room.peers.create(request.body.peer);
            response.send({
                photos: room.photos,
                peers: peers,
                connections: room.topology.connections
            });
        }

        app.get('/api/rooms/:id', (request, response) => {

            const id = request.params.id;
            const room = rooms.get(id);
            if(room) {

                response.send({
                    photos: room.photos,
                    peers: room.peers.peers,
                });

            } else {

                response.status(404).send('Room not found');
            }
        });

        //create room
        app.post('/api/rooms/', (request, response) => {

            const id = request.body.id;
            const room = {
                id: id,
                photos: [],
                connections: []
            };
            room.peers = new Peers(this.updateChannel, this.remoteLog, this.app, this.emitter);
            room.topology = new Topology(room.peers, this.updateChannel);
            //room.serverPeer = new ServerPeer(room.topology, this.remoteLog, this, this.ice, this.emitter);
            rooms.set(id, room);

            joinRoom(room, request, response);
        });

        //join room
        app.post('/api/rooms/:id', (request, response) => {

            const id = request.params.id;
            const room = rooms.get(id);
            if(room) {

                joinRoom(room, request, response);

            } else {

                response.status(404).send('Room not found');
            }
        });

        app.post('/api/rooms/:id/photos/:infoHash', (request, response) => {

            const id = request.params.id;
            const room = rooms.get(id);
            if(!room) {

                return response.status(404).send('Room not found');

            } else {

                const infoHash = request.params.infoHash;
                const url = request.body.url;

                if(this.dht) {
                    this.dht.lookup(infoHash);
                }

                const serverPeer = request.body.serverPeer;

                if(serverPeer && url) {

                    room.serverPeer.start(room, url, request, response);

                } else {
                    const peerId = request.body.peerId;
                    if(!peerId) {
                        response.status(400).send('Expected peerId');
                        return;
                    }

                    let photo;
                    if (url) {
                        photo = this.findPhoto(room.photos, infoHash);
                        if (!photo) {

                            photo = request.body;
                            photo.owners = [];

                            room.photos.unshift(photo);

                            this.sendPhotos(room, 'add', photo);

                            /*const parsed = magnet(url);
                            const event = Peers.peerToAppPeer(peer);
                            event.file = parsed.dn;
                            event.origin = origin;
                            this.emitter.emit('event', 'info', 'picAdd', event, id);*/

                            this.addOwner(room, photo.infoHash, peerId, {
                                loading: false
                            });
                        }
                    }

                    response.send(photo);
                }
            }
        });

        app.put('/api/rooms/:id/photos/:infoHash', (request, response) => {

            const id = request.params.id;
            const room = rooms.get(id);
            if(!room) {

                return response.status(404).send('Room not found');

            } else {

                const infoHash = request.params.infoHash;
                const existing = this.findPhoto(room.photos, infoHash);
                const newUrl = request.body;
                _.merge(existing, newUrl);
                existing.picSummary = this.createPicSummary(existing);
                this.sendPhotos(room, 'update', existing);
                response.send(existing);
            }
        });

        app.delete('/api/rooms/:id/photos/:infoHash', (request, response) => {

            const id = request.params.id;
            const room = rooms.get(id);
            if(room) {

                const infoHash = request.params.infoHash;

                let found = undefined;
                if (infoHash) {
                    //room.serverPeer.removeTorrent(infoHash);
                    found = room.photos.find((item, index) => {
                        if (item.infoHash === infoHash) {

                            //const parsed = magnet(item.url);
                            /*const event = Peers.peerToAppPeer(item.sharedBy);
                            event.file = parsed.dn;
                            event.origin = origin;
                            this.emitter.emit('event', 'warning', 'picRemove', event, id);*/

                            room.photos.splice(index, 1);
                            return true;
                        }
                        return false;
                    });

                    if (found) {
                        this.sendPhotos(room,'delete', infoHash);
                    } else {
                        found = false;
                    }
                }
                response.send([found]);

            } else {
                response.status(404).send('Room not found');
            }
        });
    }

    createPicSummary(url) {
        return url.picDateTaken + ' ' + url.picTitle
            + ' ' + url.picDesc + url.fileName;
    }

    findPhoto(photos, infoHash) {
        return this.findByField(photos, 'infoHash', infoHash);
    }

    findByField(photos, field, value) {
        const index = photos.findIndex(item => item[field] === value);
        let foundItem = null;
        if(index > -1) {
            foundItem = photos[index];
        }
        return foundItem;
    }

    registerOwnerRoutes(app) {
        app.post('/api/rooms/:id/photos/owners/:peerId', (request, response) => {

            const id = request.params.id;
            const room = this.rooms.get(id);
            if(!room) {

                return response.status(404).send('Room not found');

            } else {

                response.send(this.addOwner(room, request.body.infoHash, request.params.peerId, request.body));
            }
        });

        app.delete('/api/rooms/:id/photos/owners/:peerId', (request, response) => {

            const room = this.rooms.get(request.params.id);
            if(!room) {

                return response.status(404).send('Room not found');

            } else {

                response.send(this.removeOwner(room, request.params.peerId));
            }
        });

        app.put('/api/rooms/:id/photos/:infoHash/owners/:peerId', (request, response) => {

            const id = request.params.id;
            const room = this.rooms.get(id);
            if(!room) {

                return response.status(404).send('Room not found');

            } else {

                this.updateOwner(room, request.params.infoHash, request.params.peerId, request.body, response);
            }
        });
    }

    addOwner(room, infoHash, peerId, update) {

        let added = false;
        room.photos.find(item => {
            if(item.infoHash === infoHash) {
                const found = item.owners.find(item => item.peerId === peerId);
                if(!found) {
                    update = update || {};
                    update.infoHash = infoHash;
                    update.peerId = peerId;
                    item.owners.push(update);
                }
                added = true;
            }
        });

        this.sendPhotos(room,'addOwner', update);

        return added;
    }

    removeOwner(room, peerId) {
        let deleted = false;
        room.photos.forEach(item => {
            const index = item.owners.findIndex(owner => owner.peerId === peerId);
            if(index >= 0) {
                item.owners.splice(index, 1);
                deleted = true;
                if(room.serverPeer && room.serverPeer.hasPeerId(peerId)) {
                    room.serverPeer.removeTorrent(item.infoHash);
                }
            }
        });

        this.sendPhotos(room,'removeOwner', peerId);
        return deleted;
    }

    updateOwner(room, infoHash, peerId, update, response) {

        const photo = this.findPhoto(room.photos, infoHash);
        if(!photo) {

            return response.status(404).send('Photo not found');

        } else {
            const owner = photo.owners.find(item => item.peerId === peerId);
            _.merge(owner, update);
            owner.infoHash = infoHash;
            this.sendPhotos(room,'updateOwner', owner);
            response.send(owner);
        }
    }

    registerConnectionRoutes(app) {
        app.post('/api/rooms/:id/connections', (request, response) => {

            const room = this.rooms.get(request.params.id);
            if(!room) {

                return response.status(404).send('Room not found');

            } else {

                const connection = request.body;
                connection.fileName = decodeURIComponent(connection.fileName);
                room.topology.connect(connection);

                response.send(true)
            }
        });

        app.delete('/api/rooms/:id/connections', (request, response) => {

            const room = this.rooms.get(request.params.id);
            if(!room) {

                return response.status(404).send('Room not found');

            } else {

                const infoHash = request.body.infoHash;
                room.topology.disconnect(infoHash);

                response.send(true)
            }
        });
    }

    sendPhotos(room, type, item) {

        const clients = [...room.peers.clientsBySessionId.values()];
        this.updateChannel.send({
            event: 'photos',
            data: {
                type: type,
                item: item
            }
        }, clients);
    }

    registerPeerRoutes(app) {

        app.put('/api/rooms/:id/peers/:peerId', (request, response) => {

            const room = this.rooms.get(request.params.id);
            if(!room) {

                return response.status(404).send('Room not found');

            } else {

                room.peers.update(request, response, room);
            }
        });
    }

    setupSSE() {

        this.app.get('/api/rooms/:id/updates/', (request, response) => {

            const id = request.params.id;
            const room = this.rooms.get(id);
            if(!room) {

                return response.status(404).send('Room not found');

            } else {

                response.header('X-Accel-Buffering', 'no');
                const client = response;
                this.updateChannel.addClient(request, response, error => {
                    const sessionId = client.req.query.sessionId;
                    room.peers.clientsBySessionId.set(sessionId, client);
                });
            }
        });

        this.updateChannel.on('connect', (channel, request) => {

            const id = request.params.id;
            const room = this.rooms.get(id);
            if(room) {
                room.peers.connect(request.query.sessionId);
            }
        });

        this.updateChannel.on('disconnect', (channel, response) => {

            const id = response.req.params.id;
            const room = this.rooms.get(id);
            if(room) {
                room.peers.disconnect(response.req, response);
            }
        });
    }
};