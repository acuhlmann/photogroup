import Logger from 'js-logger';
import moment from "moment";
import shortid  from 'shortid';
import StringUtil from "../util/StringUtil";

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
    }

    add(torrentId, secure, fromCache) {

        let parsed;
        try {
            parsed = window.parsetorrent(torrentId);
        } catch(e) {
            Logger.error('Invalid torrendId ' + torrent + ' ' + e);
        }
        const key = parsed.infoHash;
        this.stopWatch.set(key, new Date().getTime());
        Logger.info('add ' + parsed.name + ' ' + key);
        //Logger.time('add ' + parsed.name + ' ' + key);
        const photo = {
            infoHash: shortid.generate(),
            rendering: true, secure: secure, fromCache: fromCache,
            peerId: this.master.client.peerId, owners: []
        };
        //this.master.emitter.emit('photos', {type: 'add', item: photo});

        const self = this;
        const torrent = this.master.addSeedOrGetTorrent('add', torrentId, torrent => {

            //console.timeEnd('adding ' + torrent.infoHash);
            const date = new Date().getTime() - this.stopWatch.get(torrent.infoHash);
            const passed = moment(date).format("mm:ss");
            Logger.info('this.client.add ' + torrent.infoHash + ' ' + passed);

            photo.loading = photo.rendering = false;
            photo.torrent = torrent;
            photo.url = torrent.magnetURI;
            photo.infoHash = torrent.infoHash;
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

    seed(files, secure, origFile, callback) {

        const self = this;

        Logger.info('TorrendAddition.seed ' + JSON.stringify(files));

        const photo = {
            infoHash: shortid.generate(),
            seed: true, rendering: true, file: files, origFile: files, secure: secure,
            peerId: this.master.client.peerId, owners: []
        };
        this.master.emitter.emit('photos', {
            type: 'add', item: photo
        });

        const torrent = this.master.addSeedOrGetTorrent('seed', files, torrent => {

            Logger.info('Client is seeding ' + torrent.infoHash);

            photo.loading = photo.rendering = false;
            photo.torrent = torrent;
            photo.infoHash = torrent.infoHash;
            photo.url = torrent.magnetURI;
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
                    photo: photo,
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

        /*

        //in case local indexeddb data is lost for some reason, reseed file.
        const fileBak = file[0];
        torrent.on('error', err => {

            Logger.error('torrent.seed.error '+JSON.stringify(err));
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
        */
    }

    addToDom(photo) {

        const self = this;
        photo.torrent.files.forEach(file => {
            photo.torrentFile = file;
            self.emitter.emit('torrentReady', photo);
        });
    }

    metadata(torrent) {

        Logger.info('metadata '+ torrent.infoHash);
        //temporary disable to try wire event approach.
        this.master.peers.connect(torrent, this.master.client.peerId);

        this.master.service.addOwner(torrent.infoHash, this.master.client.peerId).then(() => {
            Logger.info('added owner ' + torrent.name);
        });

        //Once generated, stores the metadata for later use when re-adding the torrent!
        const parsed = window.parsetorrent(torrent.torrentFile);
        const key = parsed.infoHash;
        Logger.info('metadata ' + parsed.name + ' ' + key);

        const self = this;
        //return;
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
        Logger.info('infoHash '+infoHash);
    }

    noPeers(t, announceType) {
        Logger.warn('noPeers '+announceType);
    }

    warning(t, err) {
        Logger.warn('warning '+err);
    }

    trackerAnnounce(...rest) {
        //Logger.info('trackerAnnounce ' + rest);
    }

    peer(peer, source) {
        Logger.info('Webtorrent peer ' + peer.id + ' ' + source);
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