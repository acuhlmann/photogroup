export default class TorrentDeletion {

    constructor(service, torrentsDb, emitter) {
        this.service = service;
        this.torrentsDb = torrentsDb;
        this.emitter = emitter;
    }

    log(message) {
        this.emitter.emit('log', message);
    }

    update() {
        this.emitter.emit('update');
    }

    deleteItem(torrent) {
        return this.service.delete(torrent.magnetURI)
            .then(response => {
                this.log('deleted ' + response);

                return this.deleteTorrent(torrent);
            });
    }

    deleteTorrent(torrent) {
        const scope = this;
        return new Promise((resolve, reject) => {

            if(torrent.client) {
                if(torrent.infoHash) {
                    torrent.client.remove(torrent.infoHash, () => {
                        scope.log('torrent removed ' + torrent.magnetURI);
                        resolve(torrent.magnetURI);
                    }, () => {
                        const msg = 'error client.remove ' + JSON.stringify(arguments);
                        scope.log(msg);
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