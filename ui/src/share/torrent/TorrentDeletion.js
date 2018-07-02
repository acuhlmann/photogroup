import Logger from 'js-logger';

export default class TorrentDeletion {

    constructor(service, torrentsDb, emitter) {
        this.service = service;
        this.torrentsDb = torrentsDb;
        this.emitter = emitter;
    }

    update() {
        this.emitter.emit('update');
    }

    deleteItem(torrent) {
        return this.service.delete(torrent.magnetURI)
            .then(response => {
                Logger.info('deleted ' + response);

                return this.deleteTorrent(torrent);
            });
    }

    deleteTorrent(torrent) {
        return new Promise((resolve, reject) => {

            if(torrent.client) {
                if(torrent.infoHash) {
                    torrent.client.remove(torrent.infoHash, () => {
                        Logger.info('torrent removed ' + torrent.magnetURI);

                        resolve(torrent.magnetURI);
                    }, () => {
                        const msg = 'error client.remove ' + JSON.stringify(arguments);
                        Logger.error(msg);
                        reject(msg);
                    });
                } else {
                    reject('Could not find torrent.infoHash to delete');
                }
            } else {
                resolve(torrent.magnetURI);
            }
        }).then(() => {

            return this.deleteTorrentDbEntry(torrent);
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