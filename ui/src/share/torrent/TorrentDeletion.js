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

        return this.service.delete(tile.infoHash)
            .then(() => {
                Logger.info('deleted ' + tile.infoHash);
                return tile.infoHash;
            });
    }

    handlePhotoDeleteEvent(infoHash) {
        const isMultiFileTorrent = infoHash.includes('-');
        if(isMultiFileTorrent) {
            const parts = infoHash.split('-');
            const torrentId = parts[0];
            const path = parts[1];
            const torrent = this.master.client.get(torrentId);
            if(!torrent) return;
            const fileIndex = torrent.files.findIndex(item => item.path === path);
            torrent.files.splice(fileIndex, 1);
            if(torrent.files.length < 1) {

                this.deleteTorrent(torrent).then(infoHash => {
                    Logger.info('deleteTorrent done ' + infoHash);
                });
            }
        } else {
            this.findAndDeleteTorrent(infoHash);
        }
    }

    findAndDeleteTorrent(infoHash) {
        const torrent = this.master.client.get(infoHash);
        if(torrent) {
            this.deleteTorrent(torrent).then(infoHash => {
                Logger.info('deleteTorrent done ' + infoHash);
            });
        }
    }

    async deleteTorrent(torrent) {

        this.master.peers.disconnect(torrent.infoHash);

        try {

            await this.deleteTorrentDbEntry(torrent);

        } catch(e) {
            Logger.error('cannot delete ' + e);
            const torrentsDb = new IdbKvStore(torrent.infoHash);
            torrentsDb.clear((e, value) => {
                if (e) {
                    Logger.error('cannot delete ' + e);
                }
                Logger.info('deleted ');
            });
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
        const key = torrent.infoHash;

        return new Promise((resolve, reject) => {

            if(!key) {
                reject();
            } else {
                self.torrentsDb.remove(key, (err, value) => {
                    if (err) {
                        reject(err);
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
                        reject();
                    }
                });
            }
        });
    }
}