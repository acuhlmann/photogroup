//----------------Domain - Content rooms

import ServerPeer from './ServerPeer.js';
import Topology from './Topology.js';
import Peers from './Peers.js';
import MyDht from './MyDht.js';
import PhotoRelay, { MAX_CHUNK_BYTES, RelayError } from './PhotoRelay.js';
import { parseDetails, applyDetails, PhotoDetailsError } from './PhotoDetails.js';
import express from 'express';
import _ from 'lodash';

const SAFE_MEDIA_TYPES = new Set([
    'image/jpeg', 'image/png', 'image/gif', 'image/webp', 'image/avif', 'image/bmp',
    'image/x-icon', 'image/vnd.microsoft.icon',
    'video/mp4', 'video/webm', 'video/ogg', 'video/quicktime',
    'audio/mpeg', 'audio/mp4', 'audio/ogg', 'audio/webm', 'audio/wav', 'audio/x-wav',
    'audio/aac', 'audio/flac'
]);

// Server-copy state is the server's to set: a client PUT carrying a stale
// view of it (the whole tile is sent after rendering) must not revive a
// deleted copy, and owners only change through the owner routes.
const SERVER_MANAGED_FIELDS = ['owners', 'hasServerCopy', 'serverCopySize', 'serverCopyReceived',
    'serverCopyRequestedAt', 'serverCopyUploader'];
const RELAY_SWEEP_MS = 5 * 60 * 1000;

export default class Rooms {

    constructor(updateChannel, remoteLog, app, emitter, ice, tracker) {
        this.updateChannel = updateChannel;
        this.remoteLog = remoteLog;
        this.app = app;
        this.emitter = emitter;
        this.ice = ice;
        this.tracker = tracker;

        this.rooms = new Map();
        this.relay = new PhotoRelay();
        //this.dht = new MyDht();
        //this.dht.start();

        //dispatched by Peers when someone disconnects, need to remove all ownerships.
        emitter.on('removeOwner', (peerId) => {

            [...this.rooms.values()].forEach(room => {
                this.removeOwner(room, peerId);
                // The one still waiting may have been the one who left; it
                // is only dropped from the room's peers after this event.
                setImmediate(() => this.releaseCopiesEveryoneHas(room));
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
        this.sweepTimer = setInterval(() => this.sweepCopies(), RELAY_SWEEP_MS);
        this.sweepTimer.unref?.();
    }

    reset() {
        this.rooms.forEach(room => {
            if (room.photoIndex) room.photoIndex.clear();
        });
        this.rooms.clear();
        this.relay.clear();
    }

    /** Register room and photo routes, including authenticated shared-detail updates. */
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
                settings: room.settings,
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
                    settings: room.settings,
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
                connections: [],
                // keepCopies: leave a server copy of every photo for people
                // who join later, instead of only when someone needs one.
                settings: { keepCopies: false }
            };
            room.peers = new Peers(this.updateChannel, this.remoteLog, this.app, this.emitter);
            room.topology = new Topology(room.peers, this.updateChannel);
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
                        SERVER_MANAGED_FIELDS.forEach(field => delete photo[field]);
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
                    // Shared title/description/rating only change through the
                    // validated, attributed details route below.
                    delete update.details;
                    // Nor can anyone take over a photo by rewriting its owner.
                    delete update.peerId;
                    SERVER_MANAGED_FIELDS.forEach(field => delete update[field]);
                    _.merge(existing, update);
                    return existing;
                }).filter(item => item !== null);
                this.sendPhotos(room, this.allRoomClients(room),'update', updated);
                response.send(updated);
            }
        });

        // Anyone in the room can title, describe and rate a photo; everyone
        // sees the change live and who made it.
        app.put('/api/rooms/:id/photos/details', (request, response) => {

            const room = rooms.get(request.params.id);
            if(!room) {
                return response.status(404).send('Room not found');
            }
            const body = request.body || {};
            if(typeof body.infoHash !== 'string' || !body.infoHash) {
                return response.status(400).send('Expected infoHash');
            }
            const editor = room.peers.peerForSession(body.sessionId, body.sessionToken);
            if(!editor) {
                return response.status(403).send('Join the room to edit photo details');
            }
            const photo = this.findPhoto(room, body.infoHash);
            if(!photo) {
                return response.status(404).send('Photo not found');
            }

            let changes;
            try {
                changes = parseDetails(body);
            } catch(err) {
                if(err instanceof PhotoDetailsError) {
                    return response.status(400).send(err.message);
                }
                throw err;
            }

            const details = applyDetails(photo, changes, {
                peerId: editor.peerId,
                name: editor.name || '',
                platform: editor.originPlatform || '',
            });
            const item = { infoHash: photo.infoHash, details };
            this.sendPhotos(room, this.allRoomClients(room), 'update', [item]);
            response.send(item);
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
                            this.relay.delete(room.id, infoHash);
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
     * The caller's peer, proven by its session token. Sent as headers by
     * fetch; JSON bodies may carry them as sessionId/sessionToken instead.
     */
    sessionPeer(room, request) {
        const sessionId = request.get('X-Session-Id') || request.body?.sessionId;
        const token = request.get('X-Session-Token') || request.body?.sessionToken;
        return room.peers.peerForSession(sessionId, token);
    }

    /** Someone who can upload the photo's bytes: its sharer or anyone who has it all. */
    static holds(photo, peerId) {
        return photo.peerId === peerId
            || (photo.owners || []).some(owner => owner.peerId === peerId && !owner.loading);
    }

    /** Server-copy fields of a photo, sent to the room as a partial update. */
    static copyState(photo) {
        return {
            infoHash: photo.infoHash,
            hasServerCopy: !!photo.hasServerCopy,
            serverCopySize: photo.serverCopySize,
            serverCopyReceived: photo.serverCopyReceived,
            serverCopyRequestedAt: photo.serverCopyRequestedAt,
            serverCopyUploader: photo.serverCopyUploader,
        };
    }

    sendCopyState(room, photos) {
        if (photos.length > 0) {
            this.sendPhotos(room, this.allRoomClients(room), 'update', photos.map(photo => Rooms.copyState(photo)));
        }
    }

    dropCopy(room, photo) {
        this.relay.delete(room.id, photo.infoHash);
        photo.hasServerCopy = false;
        delete photo.serverCopySize;
        delete photo.serverCopyReceived;
        delete photo.serverCopyUploader;
    }

    /**
     * A copy nobody needs any more goes: once everyone in the room has the
     * photo (unless the room keeps copies for latecomers). An empty room
     * keeps its copies until they expire; someone may come back for them.
     */
    releaseCopiesEveryoneHas(room) {
        const peers = room.peers.peers;
        if (peers.length === 0) return [];
        const everyoneHas = photo => peers.every(peer => Rooms.holds(photo, peer.peerId));
        // A request nobody needs answered any more: don't let a holder who
        // comes back later upload for it.
        const answered = room.photos.filter(photo => photo.serverCopyRequestedAt && everyoneHas(photo));
        answered.forEach(photo => delete photo.serverCopyRequestedAt);
        const released = room.settings?.keepCopies ? []
            : room.photos.filter(photo => this.relay.has(room.id, photo.infoHash) && everyoneHas(photo));
        released.forEach(photo => this.dropCopy(room, photo));
        this.sendCopyState(room, [...new Set([...answered, ...released])]);
        return released;
    }

    sweepCopies() {
        this.relay.sweep().forEach(entry => {
            const room = this.rooms.get(entry.roomId);
            const photo = room && this.findPhoto(room, entry.infoHash);
            if (photo) {
                this.dropCopy(room, photo);
                this.sendCopyState(room, [photo]);
            }
        });
        this.rooms.forEach(room => this.releaseCopiesEveryoneHas(room));
    }

    /**
     * Temporary server copy ("pin") of a photo, for when P2P can't connect.
     * Pinned only when needed: a receiver whose transfer stalled asks for
     * one (request), and a holder's app uploads it in resumable chunks; a
     * holder also pins on its way into the background if someone still
     * lacks the photo, and right after sharing when the room keeps copies.
     * The infoHash is a query parameter because compound hashes contain '/'.
     */
    registerPhotoRelayRoutes(app) {
        const rawChunk = express.raw({ type: () => true, limit: MAX_CHUNK_BYTES });

        // Room, photo and caller of a copy request, or null once it has answered.
        const lookup = (request, response) => {
            const fail = (status, message) => {
                response.status(status).send(message);
                return null;
            };
            const room = this.rooms.get(request.params.id);
            if (!room) return fail(404, 'Room not found');
            const infoHash = request.query.infoHash ? decodeURIComponent(request.query.infoHash) : null;
            if (!infoHash) return fail(400, 'Expected infoHash');
            const photo = this.findPhoto(room, infoHash);
            if (!photo) return fail(404, 'Photo not found');
            const peer = this.sessionPeer(room, request);
            if (!peer) return fail(403, 'Join the room first');
            return { room, infoHash, photo, peer };
        };

        app.put('/api/rooms/:id/photos/blob', rawChunk, async (request, response) => {
            const found = lookup(request, response);
            if (!found) return;
            const { room, infoHash, photo, peer } = found;
            if (!Rooms.holds(photo, peer.peerId)) {
                return response.status(403).send('Only someone who has the photo can leave a copy');
            }
            if (!Buffer.isBuffer(request.body) || request.body.length === 0) {
                return response.status(400).send('Expected photo bytes');
            }
            let entry;
            try {
                entry = await this.relay.append(room.id, infoHash, {
                    offset: Number(request.query.offset),
                    size: Number(request.query.size),
                    buffer: request.body,
                    uploader: peer.peerId,
                    contentType: request.headers['content-type'],
                });
            } catch (err) {
                if (!(err instanceof RelayError)) throw err;
                const status = { TOO_LARGE: 413, QUOTA: 413, EXISTS: 409, BUSY: 409, OFFSET: 409 }[err.code] || 400;
                return response.status(status).send({
                    error: err.message, code: err.code,
                    received: err.received, exists: err.code === 'EXISTS', uploading: err.code === 'BUSY'
                });
            }
            if (this.findPhoto(room, infoHash) !== photo) return response.status(404).send('Photo not found');

            photo.serverCopySize = entry.size;
            photo.serverCopyReceived = entry.received;
            photo.serverCopyUploader = peer.peerId;
            if (entry.complete) {
                photo.hasServerCopy = true;
                delete photo.serverCopyRequestedAt;
                delete photo.serverCopyUploader;
                if (!photo.fileType && entry.contentType !== 'application/octet-stream') {
                    photo.fileType = entry.contentType;
                }
            }
            this.sendCopyState(room, [photo]);
            return response.send({ infoHash, received: entry.received, size: entry.size, complete: entry.complete });
        });

        app.get('/api/rooms/:id/photos/blob', (request, response) => {
            const found = lookup(request, response);
            if (!found) return;
            const { room, infoHash, photo } = found;
            const copy = this.relay.get(room.id, infoHash);
            if (!copy) return response.status(404).send('No server copy for this photo');
            const safeName = String(photo.fileName || 'photo').replace(/["\r\n]/g, '');
            const contentType = String(photo.fileType || copy.contentType).split(';')[0].trim().toLowerCase();
            response.sendFile(copy.file, {
                dotfiles: 'allow',
                lastModified: false,
                cacheControl: false,
                headers: {
                    'Content-Type': SAFE_MEDIA_TYPES.has(contentType) ? contentType : 'application/octet-stream',
                    'X-Content-Type-Options': 'nosniff',
                    'Content-Disposition': `inline; filename="${safeName}"`,
                    'Cache-Control': 'private, no-store',
                },
            }, err => {
                if (err && !response.headersSent) response.status(err.status || 500).end();
            });
        });

        // A receiver whose transfer stalled: whoever holds the photo and is
        // awake uploads a copy (they hear this as a photo update).
        app.post('/api/rooms/:id/photos/blob/request', (request, response) => {
            const found = lookup(request, response);
            if (!found) return;
            const { room, photo } = found;
            if (photo.hasServerCopy) return response.send(Rooms.copyState(photo));
            photo.serverCopyRequestedAt = Date.now();
            this.sendCopyState(room, [photo]);
            return response.send(Rooms.copyState(photo));
        });

        app.use('/api/rooms/:id/photos/blob', (err, request, response, next) => {
            if (err?.type === 'entity.too.large') return response.status(413).send('Chunk too large');
            return next(err);
        });

        app.put('/api/rooms/:id/settings', (request, response) => {
            const room = this.rooms.get(request.params.id);
            if (!room) return response.status(404).send('Room not found');
            const peer = this.sessionPeer(room, request);
            if (!peer) return response.status(403).send('Join the room first');
            const keepCopies = request.body?.keepCopies;
            if (typeof keepCopies !== 'boolean') return response.status(400).send('Expected keepCopies true or false');
            room.settings = {
                ...room.settings,
                keepCopies,
                changedBy: { peerId: peer.peerId, name: peer.name || '' },
                changedAt: Date.now(),
            };
            this.updateChannel.send({ event: 'room', data: { settings: room.settings } }, this.allRoomClients(room));
            this.releaseCopiesEveryoneHas(room);
            return response.send(room.settings);
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
            this.releaseCopiesEveryoneHas(room);
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
            this.releaseCopiesEveryoneHas(room);
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

        // sendBeacon from a tab going to the background: only away, not gone.
        app.post('/api/rooms/:id/peers/:peerId/away', (request, response) => {

            const room = this.rooms.get(request.params.id);
            if(!room) {
                return response.status(404).send('Room not found');
            }
            const sessionId = request.query.sessionId;
            if(typeof sessionId !== 'string' || !sessionId) {
                return response.status(400).send('Expected sessionId');
            }
            response.send(room.peers.markAway(sessionId, request.params.peerId, request.query.token));
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