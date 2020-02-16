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

        /*
        //TODO: add server peering back in.
        app.post('/api/rooms/:id/photos/server', (request, response) => {

            if(serverPeer && requestPhoto.url) {
                room.serverPeer.start(room, requestPhoto.url, request, response);
            }
        });
        */

        app.post('/api/rooms/:id/photos/', (request, response) => {

            const id = request.params.id;
            const room = rooms.get(id);

            if(!room) {

                return response.status(404).send('Room not found');

            } else {

                request.body.photos.forEach(item => {
                    if(item.infoHash) {
                        item.infoHash = decodeURIComponent(item.infoHash);
                    }
                });

                const responsePhotos = request.body.photos.map(requestPhoto => {

                    const infoHash = requestPhoto.infoHash;

                    if(this.dht) {
                        this.dht.lookup(infoHash);
                    }

                    const peerId = requestPhoto.peerId;
                    if(!peerId) {
                        response.status(400).send('Expected peerId');
                        return;
                    }

                    let photo = this.findPhoto(room.photos, infoHash);
                    if (!photo) {

                        photo = requestPhoto;
                        photo.owners = [];

                        room.photos.unshift(photo);
                    }
                    return photo;
                });

                const sessionId = request.body.sessionId;
                this.sendPhotos(room, this.allRoomClientsExcept(room, sessionId), 'add', responsePhotos);
                this.addOwner(room, responsePhotos.map(photo => {
                    return {
                        infoHash: photo.infoHash,
                        peerId: photo.peerId,
                        loading: false
                    }
                }));
                response.send(responsePhotos);
            }
        });

        app.put('/api/rooms/:id/photos/', (request, response) => {

            const id = request.params.id;
            const room = rooms.get(id);
            if(!room) {

                return response.status(404).send('Room not found');

            } else {

                request.body.forEach(item => {
                    if(item.infoHash) {
                        item.infoHash = decodeURIComponent(item.infoHash);
                    }
                });

                const updated = request.body.map(update => {
                    const infoHash = update.infoHash;
                    const existing = this.findPhoto(room.photos, infoHash);
                    _.merge(existing, update);
                    existing.picSummary = this.createPicSummary(existing);
                    return existing;
                });
                this.sendPhotos(room, this.allRoomClients(room),'update', updated);
                response.send(updated);
            }
        });

        app.delete('/api/rooms/:id/photos/', (request, response) => {

            const id = request.params.id;
            const room = rooms.get(id);
            if(room) {

                const infoHash = decodeURIComponent(request.body.infoHash);

                let found = undefined;
                if (infoHash) {
                    //room.serverPeer.removeTorrent(infoHash);
                    found = room.photos.find((item, index) => {
                        if (item.infoHash === infoHash) {
                            room.photos.splice(index, 1);
                            return true;
                        }
                        return false;
                    });

                    if (found) {
                        this.sendPhotos(room, this.allRoomClients(room),'delete', infoHash);
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

    createPicSummary(photo) {
        //return url.picDateTaken + ' ' + url.picTitle
        //    + ' ' + url.picDesc + url.fileName;
        return Rooms.addEmptySpaces([photo.picDateTaken, photo.picTitle, photo.picDesc, photo.fileName]);
    }

    static addEmptySpaces(values) {
        return values
            .filter(item => item)
            .map(value => value && value !== null ? value + ' ' : '')
            .join('').replace(/ $/,'');
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
        app.post('/api/rooms/:id/photos/owners/', (request, response) => {

            const id = request.params.id;
            const room = this.rooms.get(id);
            if(!room) {

                return response.status(404).send('Room not found');

            } else {

                request.body.forEach(item => {
                    if(item.infoHash) {
                        item.infoHash = decodeURIComponent(item.infoHash);
                    }
                });
                response.send(this.addOwner(room, request.body));
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

        app.put('/api/rooms/:id/photos/owners/', (request, response) => {

            const id = request.params.id;
            const room = this.rooms.get(id);
            if(!room) {

                return response.status(404).send('Room not found');

            } else {

                request.body.forEach(item => {
                    if(item.infoHash) {
                        item.infoHash = decodeURIComponent(item.infoHash);
                    }
                });
                this.updateOwner(room, request.body, response);
            }
        });
    }

    addOwner(room, updates) {

        let added = false;
        const updated = updates.map(update => {
            added = false;
            room.photos.find(item => {
                if(item.infoHash === update.infoHash) {
                    const found = item.owners.find(item => item.peerId === update.peerId);
                    if(!found) {
                        update = update || {};
                        item.owners.push(update);
                    }
                    added = true;
                }
            });
            return update;
        }).filter(item => item);

        if(added) {
            this.sendPhotos(room, this.allRoomClients(room),'addOwner', updated);
        }

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

        this.sendPhotos(room, this.allRoomClients(room),'removeOwner', peerId);
        return deleted;
    }

    updateOwner(room, updates, response) {

        /*const infoHashes = [...new Set(room.photos
            .filter(item => item.includes('-'))
            .map(item => {
                return item.infoHash.split('-')[0];
            }))];

        const haveFileHashes = updates
            .filter(item => infoHashes.includes(item.infoHash))
            .map(item => item.infoHash);

        const photosWithFileHashes = room.photos.filter(item => haveFileHashes
            .includes(item.infoHash.split('-')[0]));*/

        const updated = updates.map(update => {
            const photo = this.findPhoto(room.photos, update.infoHash);
            if(!photo) {

                return false

            } else {
                const owner = photo.owners.find(item => item.peerId === update.peerId);
                if(owner) {
                    _.merge(owner, update);
                    return owner;
                } else {
                    return false;
                }
            }
        }).filter(item => item);

        if(updated.length > 0) {
            this.sendPhotos(room, this.allRoomClients(room), 'updateOwner', updated);
            return response.send(true);
        } else {
            //return response.status(404).send('Photo not found');
        }
        return response.send(true);
    }

    registerConnectionRoutes(app) {
        app.post('/api/rooms/:id/connections', (request, response) => {

            const room = this.rooms.get(request.params.id);
            if(!room) {

                return response.status(404).send('Room not found');

            } else {

                const connection = request.body;
                if(connection.infoHash) {
                    connection.infoHash = decodeURIComponent(connection.infoHash);
                }
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

                const infoHash = decodeURIComponent(request.body.infoHash);
                room.topology.disconnect(infoHash);

                response.send(true)
            }
        });
    }

    allRoomClients(room) {
        return [...room.peers.clientsBySessionId.values()];
    }

    allRoomClientsExcept(room, sessionId) {
        return [...room.peers.clientsBySessionId.entries()]
            .filter(item => {
                return item[0] !== sessionId
            })
            .map(item => item[1])
    }

    sendPhotos(room, clients, type, item) {

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