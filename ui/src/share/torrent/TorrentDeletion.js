import Logger from 'js-logger';

export default class TorrentDeletion {

    constructor(service, torrentsDb, emitter) {
        this.service = service;
        this.torrentsDb = torrentsDb;
        this.emitter = emitter;
    }

    update(numPeers) {
        if(numPeers) {
            this.emitter.emit('numPeers', Number(numPeers));
        }
    }

    deleteItem(torrent) {

        this.update(torrent.numPeers);
        this.emitter.emit('disconnectNode', torrent.infoHash);

        return this.service.delete(torrent.infoHash)
            .then(() => {
                Logger.info('deleted ' + torrent.infoHash);
                return torrent.infoHash;
            });
    }

    deleteTorrent(torrent) {

        this.update(torrent.numPeers);
        this.emitter.emit('disconnectNode', torrent.infoHash);

        return new Promise((resolve, reject) => {

            if(torrent.client) {
                if(torrent.infoHash) {
                    torrent.client.remove(torrent.infoHash, () => {
                        Logger.info('torrent removed ' + torrent.infoHash);
                        this.update(torrent.numPeers);
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
        const scope = this;
        const key = torrent.infoHash;
        return new Promise((resolve, reject) => {

            scope.torrentsDb.remove(key, (err, value) => {
                if (err) {
                    reject(err);
                }

                resolve(torrent.magnetURI);
            });
        });
    }
}