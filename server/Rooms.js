//----------------Domain - Content rooms

import ServerPeer from './ServerPeer.js';
import Topology from './Topology.js';
import Peers from './Peers.js';
import MyDht from './MyDht.js';
import PhotoRelay, { MAX_PHOTO_BYTES, PhotoTooLargeError } from './PhotoRelay.js';
import express from 'express';
import _ from 'lodash';

const SAFE_MEDIA_TYPES = new Set([
    'image/jpeg', 'image/png', 'image/gif', 'image/webp', 'image/avif', 'image/bmp',
    'image/x-icon', 'image/vnd.microsoft.icon',
    'video/mp4', 'video/webm', 'video/ogg', 'video/quicktime',
    'audio/mpeg', 'audio/mp4', 'audio/ogg', 'audio/webm', 'audio/wav', 'audio/x-wav',
    'audio/aac', 'audio/flac'
]);

export default class Rooms {

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
        this.registerPhotoRelayRoutes(this.app);
    }

    reset() {
        this.rooms.forEach(room => {
            if (room.photoIndex) room.photoIndex.clear();
        });
        this.rooms.clear();
    }

    registerRoomRoutes(app) {
        const rooms = this.rooms;

        app.delete('/api/rooms', (request, response) => {
            this.reset();
            response.send({message: 'success'});
        });

        function joinRoom(room, request, response) {
            const peer = request.body.peer;
            const sessionToken = room.peers.claimSession(peer?.sessionId, request.body.sessionToken);
            const peers = room.peers.create(peer, !!sessionToken);
            response.send({
                photos: room.photos,
                peers: peers,
                connections: room.topology.connections,
                sessionToken: sessionToken || undefined
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
            if (!request.body.peer) {
                return response.status(400).send({ error: 'Peer data is required' });
            }

            const existing = rooms.get(id);
            if (existing) {
                joinRoom(existing, request, response);
                return;
            }

            const room = {
                id: id,
                photos: [],
                photoIndex: new Map(),
                connections: []
            };
            room.peers = new Peers(this.updateChannel, this.remoteLog, this.app, this.emitter);
            room.topology = new Topology(room.peers, this.updateChannel);
            room.relay = new PhotoRelay();
            //room.serverPeer = new ServerPeer(room.topology, this.remoteLog, this, this.ice, this.emitter, this.tracker);
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

                const responsePhotos = [];

                for (const requestPhoto of request.body.photos) {
                    const infoHash = requestPhoto.infoHash;

                    if (!infoHash) {
                        return response.status(400).send('Expected infoHash');
                    }

                    if(this.dht) {
                        this.dht.lookup(infoHash);
                    }

                    const peerId = requestPhoto.peerId;
                    if(!peerId) {
                        return response.status(400).send('Expected peerId');
                    }

                    let photo = this.findPhoto(room, infoHash);
                    if (!photo) {

                        photo = requestPhoto;
                        photo.owners = [];

                        room.photos.unshift(photo);
                        this.addToPhotoIndex(room, photo);
                    }
                    responsePhotos.push(photo);
                }

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
                    const existing = this.findPhoto(room, infoHash);
                    if (!existing) return null;
                    _.merge(existing, update);
                    return existing;
                }).filter(item => item !== null);
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
                            this.removeFromPhotoIndex(room, infoHash);
                            room.relay?.delete(infoHash);
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

    /**
     * Temporary server copy ("relay") of a photo. Uploaded by the sharer as
     * insurance; downloaded by a peer only when P2P stalls. The infoHash is
     * passed as a query parameter because compound hashes contain '/'.
     */
    registerPhotoRelayRoutes(app) {
        const rawBody = express.raw({ type: () => true, limit: MAX_PHOTO_BYTES });

        app.post('/api/rooms/:id/photos/blob', rawBody, (request, response) => {
            const room = this.rooms.get(request.params.id);
            if (!room) return response.status(404).send('Room not found');
            const infoHash = request.query.infoHash ? decodeURIComponent(request.query.infoHash) : null;
            if (!infoHash) return response.status(400).send('Expected infoHash');
            const photo = this.findPhoto(room, infoHash);
            if (!photo) return response.status(404).send('Photo not found');
            const peerId = request.query.peerId;
            if (typeof peerId !== 'string' || !peerId) return response.status(400).send('Expected uploader peerId');
            if (peerId !== photo.peerId) return response.status(403).send('Only the photo owner can upload a server copy');
            if (photo.hasServerCopy) return response.status(409).send('Server copy already exists');
            if (!Buffer.isBuffer(request.body) || request.body.length === 0) {
                return response.status(400).send('Expected photo bytes');
            }
            room.relay = room.relay || new PhotoRelay();
            try {
                const stored = room.relay.put(infoHash, request.body, request.headers['content-type']);
                photo.hasServerCopy = true;
                photo.serverCopySize = stored.size;
                if (!photo.fileType && stored.contentType !== 'application/octet-stream') {
                    photo.fileType = stored.contentType;
                }
                this.sendPhotos(room, this.allRoomClients(room), 'update', [photo]);
                return response.send({ infoHash, size: stored.size, hasServerCopy: true });
            } catch (err) {
                if (err instanceof PhotoTooLargeError) return response.status(413).send(err.message);
                throw err;
            }
        });

        app.get('/api/rooms/:id/photos/blob', (request, response) => {
            const room = this.rooms.get(request.params.id);
            if (!room) return response.status(404).send('Room not found');
            const infoHash = request.query.infoHash ? decodeURIComponent(request.query.infoHash) : null;
            if (!infoHash) return response.status(400).send('Expected infoHash');
            const copy = room.relay?.get(infoHash);
            if (!copy) return response.status(404).send('No server copy for this photo');
            const photo = this.findPhoto(room, infoHash);
            const safeName = String(photo?.fileName || 'photo').replace(/["\r\n]/g, '');
            const contentType = String(photo?.fileType || copy.contentType).split(';')[0].trim().toLowerCase();
            response.header('Content-Type', SAFE_MEDIA_TYPES.has(contentType) ? contentType : 'application/octet-stream');
            response.header('X-Content-Type-Options', 'nosniff');
            response.header('Content-Length', copy.size);
            response.header('Content-Disposition', `inline; filename="${safeName}"`);
            response.header('Cache-Control', 'private, max-age=3600');
            return response.send(copy.buffer);
        });

        app.use('/api/rooms/:id/photos/blob', (err, request, response, next) => {
            if (err?.type === 'entity.too.large') return response.status(413).send('Photo copy too large');
            return next(err);
        });
    }

    static addEmptySpaces(values) {
        return values
            .filter(item => item)
            .map(value => value && value !== null ? value + ' ' : '')
            .join('').replace(/ $/,'');
    }

    findPhoto(room, infoHash) {
        if (room.photoIndex) {
            return room.photoIndex.get(infoHash) || null;
        }
        // Fallback for rooms created before the index existed
        const found = room.photos.find(item => item.infoHash === infoHash);
        return found || null;
    }

    addToPhotoIndex(room, photo) {
        if (room.photoIndex && photo.infoHash) {
            room.photoIndex.set(photo.infoHash, photo);
        }
    }

    removeFromPhotoIndex(room, infoHash) {
        if (room.photoIndex) {
            room.photoIndex.delete(infoHash);
        }
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

        let anyAdded = false;
        const updated = updates.map(update => {
            const photo = this.findPhoto(room, update.infoHash);
            if (photo) {
                const found = photo.owners.find(item => item.peerId === update.peerId);
                if(!found) {
                    update = update || {};
                    photo.owners.push(update);
                }
                anyAdded = true;
            }
            return update;
        }).filter(item => item);

        if(anyAdded) {
            this.sendPhotos(room, this.allRoomClients(room),'addOwner', updated);
        }

        return anyAdded;
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
            const photo = this.findPhoto(room, update.infoHash);
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

        // sendBeacon from a closing tab; sessionId and token ride in the query
        // because beacons arrive as text/plain.
        app.post('/api/rooms/:id/peers/:peerId/leave', (request, response) => {

            const room = this.rooms.get(request.params.id);
            if(!room) {
                return response.status(404).send('Room not found');
            }
            const sessionId = request.query.sessionId;
            if(typeof sessionId !== 'string' || !sessionId) {
                return response.status(400).send('Expected sessionId');
            }
            response.send(room.peers.leaveNow(sessionId, request.params.peerId, request.query.token));
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