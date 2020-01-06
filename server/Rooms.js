//----------------Domain - Content rooms
const ServerPeer = require('./ServerPeer');
const Topology = require('./Topology');
const Peers = require('./Peers');
const magnet = require('magnet-uri');
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

        //dispatched by Peers when someone disconnects, need to remove all ownerships.
        emitter.on('removeOwner', (peerId) => {

            [...this.rooms.values()].forEach(room => {
                this.removeOwner(room, peerId);
            });
        });

        emitter.on('disconnectPeer', (sessionId) => {

            //const values = Array.from(this.rooms.values());
            Object.values(this.rooms).forEach(room => {
                room.clients = room.clients.filter(client => sessionId !== client.req.query.sessionId)
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
                peers: peers
            });
        }

        //create room
        app.post('/api/rooms/', (request, response) => {

            const id = request.body.id;
            const room = {
                id: id,
                clients: [],
                photos: [],
                connections: []
            };
            //room.topology = new Topology(room.clients, this.updateChannel, this.remoteLog, this.app,
            //    this.emitter, this.tracker);
            //room.serverPeer = new ServerPeer(room.topology, this.remoteLog, this, this.ice, this.emitter);
            room.peers = new Peers(this.updateChannel, this.remoteLog, this.app, this.emitter);
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

                            this.sendPhotos('add', photo);

                            /*const parsed = magnet(url);
                            const event = Peers.peerToAppPeer(peer);
                            event.file = parsed.dn;
                            event.origin = origin;
                            this.emitter.emit('event', 'info', 'picAdd', event, id);*/

                            this.addOwner(room, photo.infoHash, peerId);
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

                const infoHash = request.param.infoHash;
                const existing = this.findPhoto(room.photos, infoHash);
                const newUrl = request.body;
                _.merge(existing, newUrl);
                existing.picSummary = this.createPicSummary(existing);
                this.sendPhotos('update', existing);
                response.send(existing);
            }
        });

        app.delete('/api/rooms/:id/photos/:infoHash', (request, response) => {

            const id = request.params.id;
            const room = rooms.get(id);
            if(room) {

                const infoHash = request.param.infoHash;

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
                        this.sendPhotos('delete', infoHash);
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

                response.send(this.addOwner(room, request.body.infoHash, request.params.peerId));
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
    }

    addOwner(room, infoHash, peerId) {

        let added = false;
        room.photos.find(item => {
            if(item.infoHash === infoHash) {
                const found = item.owners.find(item => item.peerId === peerId);
                if(!found) {
                    item.owners.push({
                        peerId: peerId
                    });
                }
                added = true;
            }
        });

        this.sendPhotos('addOwner', {
            infoHash: infoHash, peerId: peerId
        });

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

        this.sendPhotos('removeOwner', peerId);
        return deleted;
    }

    registerConnectionRoutes(app) {
        app.post('/api/rooms/:id/photos/connections', (request, response) => {

            const room = this.rooms.get(request.params.id);
            if(!room) {

                return response.status(404).send('Room not found');

            } else {

                const connection = request.body;
                room.topology.connect(connection);
                room.connections = Array.from(room.topology.connections).map(item => item[1]);
                this.sendPhotos('connections', room.connections);

                response.send(connection)
            }
        });

        app.delete('/api/rooms/:id/photos/connections', (request, response) => {

            const room = this.rooms.get(request.params.id);
            if(!room) {

                return response.status(404).send('Room not found');

            } else {

                const infoHash = request.body.infoHash;
                room.topology.disconnect(infoHash);
                room.connections = Array.from(room.topology.connections).map(item => item[1]);
                this.sendPhotos('connections', room.connections);

                response.send(infoHash)
            }
        });
    }

    sendPhotos(type, item) {
        this.updateChannel.send({
            event: 'photos',
            data: {
                type: type,
                item: item
            }
        });
    }

    registerPeerRoutes(app) {

        app.put('/api/rooms/:id/peers/:peerId', (request, response) => {

            const room = this.rooms.get(request.params.id);
            if(!room) {

                return response.status(404).send('Room not found');

            } else {

                room.peers.update(request, response);
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
                //const client = response;
                this.updateChannel.addClient(request, response, error => {
                    //const sessionId = client.req.query.sessionId;
                    //room.peers.clientsBySessionId.set(sessionId, client);
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
            if(!room) {

                return response.status(404).send('Room not found');

            } else {

                room.peers.disconnect(response.req, response);
            }
        });
    }
};