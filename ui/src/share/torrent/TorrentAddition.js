import Logger from 'js-logger';
import Loader from "./Loader";
import platform from 'platform';
import idb from 'indexeddb-chunk-store';
import moment from "moment";
import shortid  from 'shortid';

/**
 * @emits TorrentAddition.emitter#added
 * @type {object} file, torrent
 *
 * @emits TorrentMaster.emitter#duplicate
 * @type {object} torrent, torrentId, files
 */
export default class TorrentAddition {

    constructor(service, torrentsDb, emitter, master) {
        this.service = service;
        this.torrentsDb = torrentsDb;
        this.emitter = emitter;
        this.stopWatch = new Map();
        this.master = master;

        this.loader = new Loader();
    }

    update(numPeers) {
        if(numPeers) {
            this.emitter.emit('numPeers', Number(numPeers));
        }
    }

    add(torrentId, secure, fromCache) {

        const parsed = window.parsetorrent(torrentId);
        const key = parsed.infoHash;
        this.stopWatch.set(key, new Date().getTime());
        Logger.info('add ' + parsed.name + ' ' + key);
        //Logger.time('add ' + parsed.name + ' ' + key);
        const photo = {
            torrent: {
                infoHash: shortid.generate()
            },
            rendering: true, secure: secure, fromCache: fromCache, peerId: this.master.client.peerId
        };

        const self = this;
        const torrent = this.master.addSeedOrGetTorrent('add', torrentId, torrent => {

            //console.timeEnd('adding ' + torrent.infoHash);
            const date = new Date().getTime() - this.stopWatch.get(torrent.infoHash);
            const passed = moment(date).format("mm:ss");
            Logger.info('this.client.add ' + torrent.infoHash + ' ' + passed);

            self.listen(torrent);

            this.update(torrent.numPeers);
            photo.loading = photo.rendering = false;
            photo.torrent = torrent;
            this.addToDom(photo);
        });

        //TODO: try kicking off ws tracker if we can't get over this torrent..._openSocket
        Logger.info('torrent created ' + torrent.infoHash);
        //return;
        return new Promise((resolve, reject) => {

            torrent.on('error', err => {
                Logger.error('torrent.add '+err);
                reject(err);
            });

            torrent.on('done', () => {
                self.done(torrent);
                resolve(torrent);
            });
        });
    }

    listen(torrent) {
        return;
        /*torrent.discovery.tracker._trackers.forEach(tracker => {

            Object.values(tracker.peers).forEach(peer => {
                Logger.debug('tracker.peers ' + peer);
            });
        });*/
    }

    seed(file, secure, origFile, callback) {

        const self = this;

        Logger.info('TorrendAddition.seed ' + JSON.stringify(file));

        const photo = {
            torrent: {
                infoHash: shortid.generate(),
            },
            seed: true, rendering: true, file: origFile, secure: secure, peerId: this.master.client.peerId
        };
        this.master.emitter.emit('photos', {
            type: 'add', item: photo
        });

        const torrent = this.master.addSeedOrGetTorrent('seed', file, torrent => {

            Logger.info('Client is seeding ' + torrent.infoHash);

            self.listen(torrent);

            this.update(torrent.numPeers);

            photo.loading = photo.rendering = false;
            photo.torrent = torrent;
            this.addToDom(photo);

            if(callback) {
                callback(torrent);
            }
        });

        this.emitter.on('torrent', torrent => {

            console.log('torrent');

        }, this);

        this.emitter.on('torrentError', err => {

            console.error('torrent ' + err.message);

            const msg = err.message;
            const isDuplicateError = msg.indexOf('Cannot add duplicate') !== -1;
            if(!isDuplicateError) {
                return;
            }

            const torrentId = msg.substring(msg.lastIndexOf('torrent ') + 8, msg.length);
            const torrent = self.master.client.get(torrentId);
            if(torrent) {
                self.emitter.emit('duplicate', {
                    torrent: torrent,
                    torrentId: torrentId,
                    file: file});
            } else {
                //self.master.torrentAddition.seed(file, undefined, file, () => {
                //    Logger.info('seeded duplicate');
                //});
            }

            if(callback) {
                callback(torrent);
            }

        }, this);

        return;

        this.update(torrent.numPeers);


        //in case local indexeddb data is lost for some reason, reseed file.
        const fileBak = file[0];
        torrent.on('error', err => {

            Logger.error('torrent.seed.error '+JSON.stringify(err));
            this.update(torrent.numPeers);
            const msg = err.message;
            const isDuplicateError = msg.indexOf('Cannot add duplicate') !== -1;
            if(!isDuplicateError) {
                if(callback) {
                    callback(torrent);
                }
                return;
            }

            const torrentId = msg.substring(msg.lastIndexOf('torrent ') + 8, msg.length);

            let newFiles;
            if(file.size > 0) {
                newFiles = file;
            } else {
                newFiles = fileBak;
            }

            this.emitter.emit('duplicate', {
                torrent: torrent,
                torrentId: torrentId,
                file: newFiles});

            if(callback) {
                callback(torrent);
            }
        });

        torrent.on('done', () => self.done(torrent));
    }

    addToDom(photo) {

        const self = this;
        photo.torrent.files.forEach(file => {
            photo.torrentFile = file;
            self.emitter.emit('torrentReady', photo);
        });

        // Trigger statistics refresh
        this.loader.start(photo.torrent);
    }

    metadata(torrent) {

        this.emitter.emit('connectNode', torrent);

        //return;

        //Once generated, stores the metadata for later use when re-adding the torrent!
        const parsed = window.parsetorrent(torrent.magnetURI);
        const key = parsed.infoHash;
        Logger.debug('metadata ' + parsed.name + ' ' + key);

        this.update(torrent.numPeers);

        //return;
        const self = this;
        this.torrentsDb.get(key, (err, value) => {
            if (err) {
                return;
            }

            if(!value) {

                try {
                    self.torrentsDb.add(key, parsed, () => {
                        Logger.warn('IndexedDB added ' + key);
                    });
                } catch(e) {
                    Logger.warn('IndexedDB error saving ' + e.message);
                }

            } else {
                Logger.warn('torrent.metadata already added ' + key + ' of name ' + value.name);
            }
        });
    }

    infoHash(t, infoHash) {
        Logger.debug('infoHash '+infoHash);
        this.update(t.numPeers);
    }

    noPeers(t, announceType) {
        Logger.debug('noPeers '+announceType);
        this.update(t.numPeers);
    }

    warning(t, err) {
        Logger.warn('warning '+err);
        this.update(t.numPeers);
    }

    wire(wire, addr) {
        Logger.info('wire ' + wire._pc + ' ' + addr);
    }

    trackerAnnounce(...rest) {
        Logger.debug('trackerAnnounce ' + rest);
    }

    peer(peer, source) {
        Logger.info('peer ' + peer.id + ' ' + source);
    }

    done(torrent) {
        this.update(torrent.numPeers);
        this.loader.onDone();

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