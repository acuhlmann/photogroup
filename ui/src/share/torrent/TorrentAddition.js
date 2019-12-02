import Logger from 'js-logger';
import Loader from "./Loader";
import platform from 'platform';
import idb from 'indexeddb-chunk-store';
import moment from "moment";

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

    add(torrentId, secure, sharedBy) {

        const parsed = window.parsetorrent(torrentId);
        const key = parsed.infoHash;
        this.stopWatch.set(key, new Date().getTime());
        Logger.info('add ' + parsed.name + ' ' + key);
        //Logger.time('add ' + parsed.name + ' ' + key);

        const scope = this;
        const torrent = this.master.addSeedOrGetTorrent('add', torrentId, torrent => {

            //console.timeEnd('adding ' + torrent.infoHash);
            const date = new Date().getTime() - this.stopWatch.get(torrent.infoHash);
            const passed = moment(date).format("mm:ss");
            Logger.info('this.client.add ' + torrent.infoHash + ' ' + passed);

            scope.listen(torrent);

            this.update(torrent.numPeers);
            this.addToDom(torrent, secure, sharedBy);
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
                scope.done(torrent);
                resolve(torrent);
            });
        });
    }

    listen(torrent) {
        return;
        /*torrent.discovery.tracker._trackers.forEach(tracker => {

            Object.values(tracker.peers).forEach(peer => {
                Logger.log('tracker.peers ' + peer);
            });
        });*/
    }

    seed(files, secure, origFile, callback) {

        const scope = this;

        Logger.info('TorrendAddition.seed ' + JSON.stringify(files));

        const torrent = this.master.addSeedOrGetTorrent('seed', files, torrent => {

            Logger.info('Client is seeding ' + torrent.infoHash);

            scope.listen(torrent);

            this.update(torrent.numPeers);

            const sharedBy = {
                peerId: torrent.client.peerId,
                originPlatform: platform.description
            };
            this.emitter.emit('added', {file: origFile, torrent: torrent,
                seed: true, sharedBy: sharedBy});

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
            const torrent = scope.master.client.get(torrentId);
            if(torrent) {
                scope.emitter.emit('duplicate', {
                    torrent: torrent,
                    torrentId: torrentId,
                    files: files});
            } else {
                //scope.master.torrentAddition.seed(files, undefined, files, () => {
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
        const fileBak = files[0];
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
            if(files.size > 0) {
                newFiles = files;
            } else {
                newFiles = fileBak;
            }

            this.emitter.emit('duplicate', {
                torrent: torrent,
                torrentId: torrentId,
                files: newFiles});

            if(callback) {
                callback(torrent);
            }
        });

        torrent.on('done', () => scope.done(torrent));
    }

    addToDom(torrent, secure, sharedBy) {

        const scope = this;
        torrent.files.forEach(file => {
            scope.emitter.emit('added', {file: file, torrent: torrent,
                secure: secure, sharedBy: sharedBy});
        });

        // Trigger statistics refresh
        this.loader.start(torrent);
    }

    metadata(torrent) {

        this.emitter.emit('connectNode', torrent);

        //Once generated, stores the metadata for later use when re-adding the torrent!
        const parsed = window.parsetorrent(torrent.torrentFile);
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
                self.torrentsDb.add(key, parsed);
            } else {
                Logger.warn('already added ' + key + ' with value ' + value);
            }
        });
    }

    infoHash(t, hash) {
        Logger.debug('infoHash '+hash);
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
        Logger.info('trackerAnnounce ' + rest);
    }

    peer(peer, source) {
        Logger.info('peer ' + peer.id + ' ' + source);
    }

    done(torrent) {
        this.update(torrent.numPeers);
        //Checks to make sure that ImmediateChunkStore has finished writing to store before destroying the torrent!
        /*const isMemStoreEmpty = setInterval(()=>{
            //Since client.seed is sequential, this is okay here.
            const empty = torrent.store && torrent.store.mem && !torrent.store.mem[torrent.store.mem.length-1];
            if(empty){
                Logger.debug(`[${torrent.infoHash}] Import into indexedDB done`);
                //torrent.destroy();
                clearInterval(isMemStoreEmpty)
            }
        }, 500)*/
    }
}