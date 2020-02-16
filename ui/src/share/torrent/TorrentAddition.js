import Logger from 'js-logger';
import shortid  from 'shortid';
import StringUtil from "../util/StringUtil";

export default class TorrentAddition {

    constructor(service, torrentsDb, emitter, master) {
        this.service = service;
        this.torrentsDb = torrentsDb;
        this.emitter = emitter;
        this.master = master;
    }

    handlePhotoAddEvent(serverPhotos) {

        if(serverPhotos.some(item => item.isFake)) {
            return;
        }

        if(serverPhotos.length > 1) {
            const infoHashes = serverPhotos.map(photo => {
                return photo.infoHash.split('-');
            });

            const torrentId = infoHashes[0][0];
            const torrent = this.master.client.get(torrentId);
            if(!torrent) {
                this._add(torrentId, serverPhotos, false, infoHashes.map(item => item[1]))
            }
        } else if(serverPhotos.length === 1) {
            const photo = serverPhotos[0];
            this.add(photo.infoHash, photo);
        }
    }

    add(torrentId, photo, fromCache) {

        const torrent = this.master.client.get(photo.infoHash);
        return new Promise((async (resolve, reject) => {

            if(photo.isFake) {
                reject('Is fake tile for perceived performance.');
            }

            if(!torrent) {
                try {
                    const result = await this._add(torrentId, [photo], fromCache);
                    resolve(result);
                } catch(e) {
                    reject(e);
                }
            } else {
                reject(false);
            }
        }));
    }

    _add(torrentId, photos, fromCache, paths) {

        Logger.info('add ' + torrentId + ' len ' + photos.length);


        const torrent = this.master.addSeedOrGetTorrent('add', torrentId, torrent => {
            Logger.info('_add done ' + torrent.name);
        });

        const self = this;
        return new Promise((resolve, reject) => {

            torrent.on('metadata', () => {

                Logger.info('add metadata ' + torrent.name);
                this.storeTorrent(torrent).then(torrent => {
                    this.addTorrent(torrent, photos, fromCache, paths);
                    this.master.service.addOwner(photos.map(photo => {
                        return {
                            infoHash: photo.infoHash,
                            peerId: this.master.client.peerId,
                            loading: true
                        }
                    })).then(() => {
                        Logger.info('added owner ' + torrent.name);
                    });
                    resolve(torrent);
                });
            });

            torrent.on('infoHash', () => {
                resolve(torrent);
            });

            torrent.on('error', err => {
                Logger.error('torrent.add '+err);
                reject(err);
            });

            torrent.on('done', () => {
                self.done(torrent);
                //resolve(torrent);
            });
        });
    }

    addTorrent(torrent, photos, fromCache, paths) {

        photos = photos.map((photo, index) => {

            if(paths) {
                photo.torrentFile = torrent.files.find(file => file.path === paths[index]);
            } else {
                photo.torrentFile = torrent.files.find(file => file.name === torrent.name);
            }
            photo.fromCache = fromCache;
            photo.peerId = this.master.client.peerId;
            photo.loading = photo.rendering = false;
            photo.torrent = torrent;
            photo.url = torrent.magnetURI;
            return photo;
        });

        this.emitter.emit('torrentReady', photos);
    }

    seed(files, secure, origFile, callback) {

        const self = this;

        const filesArr = [...files];
        Logger.info('seed ' + filesArr.map(item => item.name).join(', '));

        const photos = filesArr.map(file => {
            return {
                infoHash: shortid.generate(),
                isFake: true,
                seed: true, rendering: true, file: file, origFile: file, secure: secure,
                peerId: this.master.client.peerId, owners: []
            };
        });

        this.master.emitter.emit('photos', {type: 'add', item: photos});

        const torrent = this.master.addSeedOrGetTorrent('seed', files, torrent => {

            Logger.info('seed.done ' + torrent.infoHash);

            //this.storeTorrent(torrent);

            if(callback) {
                callback(torrent);
            }
        });

        torrent.on('infoHash', async () => {

            const toBeShared = photos.map(photo => {
                photo.infoHash = torrent.infoHash;
                if(torrent.files.length > 1) {
                    photo.infoHash += '-' + torrent.files.find(file => file.name === photo.file.name).path;
                }
                photo.url = torrent.magnetURI;
                const serverPhoto = {...photo};
                delete serverPhoto.isFake;
                delete serverPhoto.file;
                delete serverPhoto.origFile;
                delete serverPhoto.rendering;
                delete serverPhoto.loading;
                delete serverPhoto.seed;
                return serverPhoto;
            });

            Logger.info('seed.infoHash photo sharing');
            this.service.share(toBeShared).then(result => {
                Logger.info('photo shared ' + result.length);
            });
        });

        torrent.on('metadata', async () => {
            Logger.info('seed.metadata');
            this.storeTorrent(torrent).then(torrent => {

                if(photos[0].deleted) {
                    return;
                }
                photos.forEach(photo => {
                    photo.isFake = photo.loading = photo.rendering = false;
                    photo.torrent = torrent;
                    photo.infoHash = torrent.infoHash;
                    photo.url = torrent.magnetURI;
                });
                torrent.files.forEach((file, index, files) => {
                    const photo = photos[index];
                    photo.torrentFile = file;
                    if(files.length > 1) {
                        photo.infoHash += '-' + file.path;
                    }
                    //self.emitter.emit('torrentReady', photo);
                });

                //torrent.files.forEach((file, index) => self.emitter.emit('torrentReady', photos[index]));
                self.emitter.emit('torrentReady', photos);

            })
        });

        this.emitter.on('torrentError', err => {

            console.error('torrent ' + err.message);

            if(!this.isDuplicateError(err)) {
                return;
            }

            const msg = err.message;
            const torrentId = msg.substring(msg.lastIndexOf('torrent ') + 8, msg.length);
            const torrent = self.master.client.get(torrentId);
            if(torrent) {
                self.emitter.emit('duplicate', {
                    torrent: torrent,
                    torrentId: torrentId,
                    photos: photos,
                    file: files});
            } else {
                //self.master.torrentAddition.seed(file, undefined, file, () => {
                //    Logger.info('seeded duplicate');
                //});
            }

            if(callback) {
                callback(torrent);
            }

        }, this);

        return torrent;
    }

    isDuplicateError(err) {
        const msg = err.message;
        return msg.indexOf('Cannot add duplicate') !== -1;
    }

    metadata(torrent) {

        Logger.info('metadata '+ torrent.infoHash);
        this.master.peers.connect(torrent, this.master.client.peerId);
    }

    storeTorrent(torrent) {
        //Once generated, stores the metadata for later use when re-adding the torrent!
        const parsed = window.parsetorrent(torrent.torrentFile);
        const key = parsed.infoHash;
        Logger.info('metadata ' + parsed.name + ' ' + key);

        return new Promise((resolve, reject) => {

            const self = this;
            this.torrentsDb.get(key, (err, value) => {
                if (err) {
                    return;
                }

                if(!value) {
                    try {
                        self.torrentsDb.add(key, parsed, () => {
                            Logger.warn('IndexedDB added ' + key);
                            resolve(torrent);
                        });
                    } catch(e) {
                        Logger.warn('IndexedDB error saving ' + e.message);
                        resolve(torrent);
                    }

                } else {
                    Logger.warn('torrent.metadata already added ' + key + ' of name ' + value.name);
                    resolve(torrent);
                }
            });
        });

    }

    wire(wire, addr, torrent) {
        this.emitter.emit('wire', wire, addr, torrent);
        const remotePeerId = wire.peerId.toString();
        const myPeerId = this.master.client.peerId;
        //this.master.peers.connectWire(myPeerId, torrent, remotePeerId, wire.remoteAddress, wire.remotePort);

        if(remotePeerId && wire.remoteAddress) {
            const peer = this.master.peers.items.find(item => item.peerId == remotePeerId);
            if(peer) {
                const network = peer.networkChain.find(item => item.ip === wire.remoteAddress);
                if(network) {
                    Logger.info('wire peer ' + StringUtil.createNetworkLabel(network) + ' ' + addr);
                    //Logger.warn('wire peer ' + JSON.stringify(network));
                    return;
                }
            }
            //const address = (wire.remoteAddress || 'Unknown') + ':' + (wire.remotePort || 'Unknown');
            Logger.info('wire ' + addr);
        } else {
            Logger.info('wire no ' + remotePeerId);
        }
    }

    infoHash(t, infoHash) {
        //Logger.info('infoHash '+infoHash);
    }

    noPeers(t, announceType) {
        Logger.warn('noPeers ' + announceType);
    }

    warning(t, err) {
        Logger.warn('warning '+err);
    }

    trackerAnnounce(...rest) {
        //Logger.info('trackerAnnounce ' + rest);
    }

    peer(peer, source) {
        //Logger.info('Webtorrent peer ' + peer.id + ' ' + source);
    }

    done(torrent) {
        Logger.info('done ' + torrent.name);
        //Checks to make sure that ImmediateChunkStore has finished writing to store before destroying the torrent!
        /*const isMemStoreEmpty = setInterval(()=>{
            //Since client.seed is sequential, this is okay here.
            var empty = !!!torrent.store.mem[torrent.store.mem.length-1]
            if(empty){
                Logger.debug(`[${torrent.infoHash}] Destroying torrent`)
                //Destroys the torrent, removing it from the client!
                //torrent.destroy()
                clearInterval(isMemStoreEmpty)
            }
        },500);*/
    }
}