import Loader from "../Loader";

import idb from 'indexeddb-chunk-store';

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

        this.loader = new Loader();
    }

    log(message) {
        this.emitter.emit('log', message);
    }

    update() {
        this.emitter.emit('update');
    }

    addSeedOrGetTorrent(addOrSeed, uri, callback){
        const torrent = this.client.get(uri);
        if(torrent) {
            if(torrent.ready){
                callback(torrent);
                return torrent;
            }else{
                torrent.on("ready",() => {
                    callback(torrent);
                    return torrent;
                });
            }
        } else {
            return this.client[addOrSeed](uri, {"store": idb}, callback);
        }
    }

    add(torrentId) {

        this.log('add ' + torrentId);

        const scope = this;
        const torrent = this.addSeedOrGetTorrent('add', torrentId, torrent => {

            this.log('this.client.add ' + torrent.infoHash);
            this.numPeers = torrent.numPeers;
            this.update();

            this.addToDom(torrent);
        });

        torrent.on('metadata', () => scope.metadata(torrent));
        torrent.on('infoHash', hash => scope.infoHash(torrent, hash));
        torrent.on('noPeers', announceType => scope.noPeers(torrent, announceType));
        torrent.on('warning', err => scope.noPeers(torrent, err));

        return new Promise((resolve, reject) => {

            torrent.on('error', err => {
                scope.log('error torrent '+err);
                reject(err);
            });

            torrent.on('done', () => {
                scope.done(torrent);
                resolve(torrent);
            });
        });
    }

    seed(files) {

        const scope = this;

        const torrent = this.addSeedOrGetTorrent('seed', files, torrent => {

            const magnetUri = torrent.magnetURI;
            this.log('Client is seeding ' + torrent.infoHash);

            this.numPeers = torrent.numPeers;
            this.update();

            this.addToDom(torrent);

            this.service.share(magnetUri)
                .then(response => {
                    this.log('shared ' + response);
                });
        });

        torrent.on('metadata', () => scope.metadata(torrent));
        torrent.on('infoHash', hash => scope.infoHash(torrent, hash));
        torrent.on('noPeers', announceType => scope.noPeers(torrent, announceType));
        torrent.on('warning', err => scope.noPeers(torrent, err));

        //in case local indexeddb data is lost for some reason, reseed file.
        const fileBak = files[0];
        torrent.on('error', err => {
            scope.log('error torrent '+err);
            const msg = err.message;
            const isDuplicateError = msg.indexOf('Cannot add duplicate') !== -1;
            if(!isDuplicateError) return;

            const torrentId = msg.substring(msg.lastIndexOf('torrent ') + 8, msg.length);

            let newFiles;
            if(files.length > 0) {
                newFiles = files;
            } else {
                newFiles = fileBak;
            }

            this.emitter.emit('duplicate', {
                torrent: torrent,
                torrentId: torrentId,
                files: newFiles});
        });

        torrent.on('done', () => scope.done(torrent));
    }

    addToDom(torrent) {

        const scope = this;
        torrent.files.forEach(file => {
            scope.emitter.emit('added', {file: file, torrent: torrent});
        });

        // Trigger statistics refresh
        this.loader.start(torrent);
    }

    metadata(torrent) {
        this.log('metadata ' + arguments);

        //Once generated, stores the metadata for later use when re-adding the torrent!
        const parsed = window.parsetorrent(torrent.torrentFile);
        const key = parsed.infoHash;

        this.numPeers = torrent.numPeers;
        this.update();

        const scope = this;
        this.torrentsDb.get(key, (err, value) => {
            if (err) {
                return;
            }

            if(!value) {
                scope.torrentsDb.add(key, parsed);
            } else {
                scope.log('already added' + key + ' with value ' + value);
            }
        });

        this.log(`[${torrent.infoHash}] Seeding torrent`)
    }

    infoHash(t, hash) {
        this.log('infoHash '+hash);
    }

    noPeers(t, announceType) {
        this.log('noPeers '+announceType);
    }

    warning(t, err) {
        this.log('warning '+err);
    }

    done(torrent) {
        //Checks to make sure that ImmediateChunkStore has finished writing to store before destroying the torrent!
        const isMemStoreEmpty = setInterval(()=>{
            //Since client.seed is sequential, this is okay here.
            const empty = torrent.store.mem && !torrent.store.mem[torrent.store.mem.length-1];
            if(empty){
                this.log(`[${torrent.infoHash}] Import into indexedDB done`);
                clearInterval(isMemStoreEmpty)
            }
        },500)
    }
}