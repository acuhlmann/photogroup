import Logger from 'js-logger';
import IdbKvStore from "idb-kv-store";

export default class TorrentDeletion {

    constructor(service, torrentsDb, emitter, master) {
        this.service = service;
        this.torrentsDb = torrentsDb;
        this.emitter = emitter;
        this.master = master;
    }

    deleteItem(tile) {
        // Validate tile has infoHash
        if(!tile || !tile.infoHash) {
            Logger.error('deleteItem called with invalid tile (missing infoHash)');
            return Promise.reject('Invalid tile: missing infoHash');
        }

        if(tile.torrent) {
            return this.service.delete(tile.infoHash)
                .then(() => {
                    Logger.info('deleted ' + tile.infoHash);
                    return tile.infoHash;
                });
        } else {
            return new Promise((resolve) => {
                tile.deleted = true;
                this.master.emitter.emit('photos', {
                    type: 'delete', item: tile.infoHash
                });
                return this.service.delete(tile.infoHash)
                    .then(() => {
                        Logger.info('deleted ' + tile.infoHash);
                        return tile.infoHash;
                    });
                //resolve(tile.infoHash);
            });
        }
    }

    handlePhotoDeleteEvent(infoHash) {
        // Validate infoHash is provided
        if(!infoHash) {
            Logger.error('handlePhotoDeleteEvent called with undefined infoHash');
            return;
        }

        const isMultiFileTorrent = infoHash.includes('-');
        if(isMultiFileTorrent) {
            const parts = infoHash.split('-');
            const torrentId = parts[0];
            const path = parts[1];
            const torrent = this.master.client.get(torrentId);
            if(!torrent || !torrent.files) return;
            const fileIndex = torrent.files.findIndex(item => item.path === path);
            if(fileIndex >= 0) {
                torrent.files.splice(fileIndex, 1);
            }
            if(torrent.files && torrent.files.length < 1) {

                this.deleteTorrent(torrent).then(infoHash => {
                    Logger.info('deleteTorrent done ' + infoHash);
                }).catch(err => {
                    Logger.error('Failed to delete torrent: ' + err);
                });
            }
        } else {
            this.findAndDeleteTorrent(infoHash);
        }
    }

    findAndDeleteTorrent(infoHash) {
        // Validate infoHash is provided
        if(!infoHash) {
            Logger.error('findAndDeleteTorrent called with undefined infoHash');
            return;
        }

        const torrent = this.master.client.get(infoHash);
        if(torrent) {
            this.deleteTorrent(torrent).then(infoHash => {
                Logger.info('deleteTorrent done ' + infoHash);
            }).catch(err => {
                Logger.error('Failed to delete torrent: ' + err);
            });
        } else {
            Logger.warn('Torrent not found for infoHash: ' + infoHash);
        }
    }

    async deleteTorrent(torrent) {
        // Validate torrent has infoHash before proceeding
        if(!torrent || !torrent.infoHash) {
            Logger.error('deleteTorrent called with invalid torrent (missing infoHash)');
            return Promise.reject('Invalid torrent: missing infoHash');
        }

        this.master.peers.disconnect(torrent.infoHash);

        try {

            await this.deleteTorrentDbEntry(torrent);

        } catch(e) {
            Logger.error('cannot delete ' + e);
            // Only try to clear if infoHash is valid
            if(torrent.infoHash) {
                try {
                    const torrentsDb = new IdbKvStore(torrent.infoHash);
                    torrentsDb.clear((e, value) => {
                        if (e) {
                            Logger.error('cannot delete ' + e);
                        }
                        Logger.info('deleted ');
                    });
                } catch(clearError) {
                    Logger.error('Failed to clear torrent database: ' + clearError);
                }
            } else {
                Logger.warn('Cannot clear torrent database: infoHash is undefined');
            }
        }

        return new Promise((resolve, reject) => {

            if(torrent.client) {
                if(torrent.infoHash && torrent.client.get(torrent.infoHash)) {
                    torrent.client.remove(torrent.infoHash, () => {
                        Logger.info('torrent removed ' + torrent.infoHash);
                        resolve(torrent.infoHash);
                    }, () => {
                        const msg = 'error client.remove ' + JSON.stringify(arguments);
                        Logger.error(msg);
                        reject(msg);
                    });
                } else {
                    reject('Could not find torrent.infoHash to delete');
                }
            } else {
                resolve(torrent.infoHash);
            }
        }).then(() => {
            return torrent.infoHash;
            //return this.deleteTorrentDbEntry(torrent);
        });
    }

    deleteTorrentDbEntry(torrent) {
        const self = this;
        
        // Validate torrent and infoHash
        if(!torrent || !torrent.infoHash) {
            return Promise.reject(new Error('Invalid torrent: missing infoHash'));
        }
        
        const key = torrent.infoHash;

        return new Promise((resolve, reject) => {

            if(!key) {
                reject(new Error('Cannot delete: infoHash is undefined'));
            } else {
                self.torrentsDb.remove(key, (err, value) => {
                    if (err) {
                        reject(err);
                        return;
                    }

                    const store = torrent.store;
                    if(store) {
                        store.destroy(() => {
                            Logger.info('idb store destroyed');
                            store.close(() => {
                                Logger.info('idb store closed');
                                resolve(torrent.infoHash);
                            })
                        });
                    } else {
                        // Store might not exist, which is okay - just resolve
                        Logger.warn('Torrent store not found, but deletion completed');
                        resolve(torrent.infoHash);
                    }
                });
            }
        });
    }
}