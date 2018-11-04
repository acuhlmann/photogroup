import Logger from 'js-logger';
import Loader from "./Loader";

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

    constructor(service, client, torrentsDb, emitter) {
        this.service = service;
        this.client = client;
        this.torrentsDb = torrentsDb;
        this.emitter = emitter;
        this.stopWatch = new Map();


        emitter.on('sseConnections', (value, ips) => {
            //ips.
        });

        this.loader = new Loader();
    }

    update(numPeers) {
        if(numPeers) {
            this.emitter.emit('numPeers', Number(numPeers));
        }
    }

    addSeedOrGetTorrent(addOrSeed, uri, callback) {
        const torrent = this.client.get(uri);

        if(torrent) {
            this.update(torrent.numPeers);
            if(torrent.ready){
                callback(torrent);
                return torrent;
            } else {
                torrent.on("ready",() => {
                    callback(torrent);
                    return torrent;
                });
            }
        } else {

            var ANNOUNCE_URLS = [
                //`${window.location.origin}/tracker/announce`,
                //`wss://${window.location.host}/tracker/socket`
                //'http://127.0.0.1:8081/announce',
                //'ws://127.0.0.1:8081'
                //'http://' + window.location.hostname
                //'ws://' + window.location.hostname + ':65080'
                'ws://' + window.location.hostname
            ];

            return this.client[addOrSeed](uri, {
                //'store': idb,
                'announce': ANNOUNCE_URLS,
                /*getAnnounceOpts: function () {
                    // Provide a callback that will be called whenever announce() is called
                    // internally (on timer), or by the user
                    console.log('foo');
                    return {
                        uploaded: 0,
                        downloaded: 0,
                        left: 0,
                        customParam: 'blah' // custom parameters supported
                    }
                },*/
            }, callback);
            //return this.client[addOrSeed](uri, {"store": idb}, callback);
        }
    }

    add(torrentId, secure) {

        const parsed = window.parsetorrent(torrentId);
        const key = parsed.infoHash;
        this.stopWatch.set(key, new Date().getTime());
        Logger.info('add ' + parsed.name + ' ' + key);
        //Logger.time('add ' + parsed.name + ' ' + key);

        const scope = this;
        const torrent = this.addSeedOrGetTorrent('add', torrentId, torrent => {

            //console.timeEnd('adding ' + torrent.infoHash);
            const date = new Date().getTime() - this.stopWatch.get(torrent.infoHash)
            const passed = moment(date).format("mm:ss");
            Logger.info('this.client.add ' + torrent.infoHash + ' ' + passed);

            this.update(torrent.numPeers);
            this.addToDom(torrent, secure);
        });

        torrent.on('metadata', () => scope.metadata(torrent));
        torrent.on('infoHash', hash => scope.infoHash(torrent, hash));
        torrent.on('noPeers', announceType => scope.noPeers(torrent, announceType));
        torrent.on('warning', err => scope.noPeers(torrent, err));

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

    seed(files, secure, origFile, callback) {

        const scope = this;

        Logger.info('TorrendAddition.seed ' + JSON.stringify(files));

        const torrent = this.addSeedOrGetTorrent('seed', files, torrent => {

            const magnetUri = torrent.magnetURI;
            Logger.info('Client is seeding ' + torrent.infoHash);

            this.update(torrent.numPeers);
            //this.addToDom(torrent, secure, origFile);
            this.emitter.emit('added', {file: origFile, torrent: torrent, seed: true});

            this.service.share(magnetUri, secure)
                .then(response => {
                    Logger.debug('shared ' + JSON.stringify(response));
                });

            if(callback) {
                callback(torrent);
            }
        });
        this.update(torrent.numPeers);
        torrent.on('metadata', () => scope.metadata(torrent));
        torrent.on('infoHash', hash => scope.infoHash(torrent, hash));
        torrent.on('noPeers', announceType => scope.noPeers(torrent, announceType));
        torrent.on('warning', err => scope.noPeers(torrent, err));

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

    addToDom(torrent, secure) {

        const scope = this;
        torrent.files.forEach(file => {
            scope.emitter.emit('added', {file: file, torrent: torrent, secure: secure});
        });

        // Trigger statistics refresh
        this.loader.start(torrent);
    }

    metadata(torrent) {

        //Once generated, stores the metadata for later use when re-adding the torrent!
        const parsed = window.parsetorrent(torrent.torrentFile);
        const key = parsed.infoHash;
        Logger.debug('metadata ' + parsed.name + ' ' + key);

        this.update(torrent.numPeers);

        const scope = this;
        this.torrentsDb.get(key, (err, value) => {
            if (err) {
                return;
            }

            if(!value) {
                scope.torrentsDb.add(key, parsed);
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

    done(torrent) {
        this.update(torrent.numPeers);
        //Checks to make sure that ImmediateChunkStore has finished writing to store before destroying the torrent!
        const isMemStoreEmpty = setInterval(()=>{
            //Since client.seed is sequential, this is okay here.
            const empty = torrent.store.mem && !torrent.store.mem[torrent.store.mem.length-1];
            if(empty){
                Logger.debug(`[${torrent.infoHash}] Import into indexedDB done`);
                clearInterval(isMemStoreEmpty)
            }
        },500)
    }
}