import Logger from 'js-logger';

import IdbKvStore from 'idb-kv-store';
//TODO: fails in create-create-app build
//import parsetorrent from 'parse-torrent';
import Peers from '../topology/Peers';
import idb from 'indexeddb-chunk-store';
import TorrentAddition from "./TorrentAddition";
import TorrentDeletion from "./TorrentDeletion";
import TorrentCreator from "./TorrentCreator";
import FileUtil from '../util/FileUtil';
import platform from "platform";
import update from "immutability-helper";

export default class TorrentMaster {

    constructor(service, emitter) {

        const self = this;
        this.numPeers = 0;

        this.service = service;
        this.service.master = this;
        this.emitter = emitter;
        this.peers = new Peers(emitter, []);
        this.torrentsDb = new IdbKvStore('torrents');
        this.torrentAddition = new TorrentAddition(this.service, this.torrentsDb, this.emitter, this);
        this.torrentDeletion = new TorrentDeletion(this.service, this.torrentsDb, this.emitter);

        this.creator = new TorrentCreator(service, emitter, this, this.torrentAddition);
        this.creator.start();

        this.emitter.on('iceDone', () => {

            const peer = {};
            peer.originPlatform = self.originPlatform = (platform.description
                + (navigator.platform ? ' ' + navigator.platform + ' ' : '' )
                + (navigator.oscpu ? navigator.oscpu : ''));
            peer.name = localStorage.getItem('nickname');
            self.me = peer;

            self.emitter.emit('addPeerDone', peer);
            self.emitter.emit('topStateMessage', '');
        });

        this.syncWithPhotoEvents();
    }

    async findExistingContent(roomPromise) {

        return roomPromise.call(this.service)
            .then(async response => {

                if(!response) return;

                this.peers.items = response.peers;
                const photos = this.photos = response.photos;
                Logger.info(`photos: ${response.photos.length} peers ${response.peers.length}`);
                const values = await this.resurrectLocallySavedTorrents(this.photos);
                Logger.info('done with resurrectAllTorrents ' + values);
                /*Promise.all(values).then(results => {
                    Logger.info('all done with resurrectAllTorrents ' + results);
                });*/

                this.hasPeer = true;

                this.syncUiWithServerUrls(photos);

                let foundAnyMissing;
                let msg = '';
                photos.forEach(item => {

                    if(this.fillMissingOwners(item)) {
                        foundAnyMissing = true;
                    }
                    msg += item.infoHash + ' '  + item.fileName + '\n';
                });
                if(msg)
                    Logger.info('photos: ' + msg);

                if(!foundAnyMissing) {
                    //this.emitter.emit('photos', response.photos);
                }

                return response.photos;
            });
    }

    fillMissingOwners(item) {
        let foundAnyMissing;
        //check for missing owners - can happen after re-connections.
        const peerId = this.client.peerId;
        const torrent = this.client.get(item.infoHash);
        const isOwner = torrent && torrent.files.length > 0;
        if(isOwner) {
            const found = item.owners.find(owner => owner.peerId === peerId);
            if(!found) {
                foundAnyMissing = true;
                this.service.addOwner(item.infoHash, peerId);
            }
        }
        return foundAnyMissing
    }

    //more on the approach: https://github.com/SilentBot1/webtorrent-examples/blob/master/resurrection/index.js
    resurrectLocallySavedTorrents(photos) {
        //Iterates through all metadata from metadata store and attempts to resurrect them!
        const scope = this;

        return new Promise((resolve, reject) => {

            const loopResolver = value => {};
            const loopPromise = new Promise(loopResolver);

            const allPendingTorrents = [loopPromise];
            scope.torrentsDb.iterator((err, cursor) => {
                if(err) {
                    reject(err);
                }
                if(cursor) {
                    if(typeof cursor.value === 'object'){
                        allPendingTorrents.push(scope.resurrectTorrent(cursor.value, photos));
                        loopResolver(true);
                    }
                    cursor.continue()
                } else {
                    resolve(allPendingTorrents);
                }
            });

            Promise.all(allPendingTorrents).then(values => {
                Logger.info('resurrectAllTorrents ' + values);
                values.shift();
                resolve(values);
            });
        });
    }

    resurrectTorrent(metadata, photos){
        const scope = this;

        return new Promise((resolve, reject) => {

            if(typeof metadata === 'object' && metadata != null) {
                if(scope.client.get(metadata.infoHash)) {

                    Logger.info('resurrectTorrent.client.get ' + metadata.name);
                    resolve(metadata);

                } else {

                    let sharedBy = {};
                    let photo;
                    if(photos) {
                        photo = photos.find(item => item.infoHash === metadata.infoHash);
                    }
                    scope.torrentAddition.add(metadata, false, true).then(torrent => {

                        Logger.info('resurrectTorrent.add ' + torrent.infoHash);
                        resolve(torrent);

                    }, error => {
                        const msg = 'error, failed to resurrect ' + JSON.stringify(arguments);
                        Logger.error(msg);
                        reject(msg);
                    });
                    if(photo) {
                        //this.emitter.emit('addedTorrent', photo);
                    }
                }

            } else {
                reject(false);
            }
        });
    }

    get client() {
        return this.creator.client;
    }

    addSeedOrGetTorrent(addOrSeed, uri, callback) {

        const torrent = this.client[addOrSeed](uri, { 'announce': window.WEBTORRENT_ANNOUNCE, 'store': idb }, callback);
        //const torrent = this.client[addOrSeed](uri, { 'announce': window.WEBTORRENT_ANNOUNCE}, callback);

        Logger.info('addSeedOrGetTorrent ' + torrent.infoHash + ' ' + torrent.name);

        const scope = this;
        let lastProgress = 0;
        let lastDownloadSpeed = 0;
        torrent.on('download', bytes => {
            //Logger.trace('just downloaded: ' + bytes)
            //Logger.trace('total downloaded: ' + torrent.downloaded)
            const progress = torrent.progress * 100;
            const downloadSpeed = torrent.downloadSpeed;
            if(progress !== lastProgress || downloadSpeed !== lastDownloadSpeed) {
                lastProgress = progress;
                lastDownloadSpeed = downloadSpeed;
                const downloadSpeedLabel = FileUtil.formatBytes(downloadSpeed) + '/sec';
                //Logger.trace('torrent.download speed: ' + downloadSpeedLabel + ' ' + progress);
                scope.emitter.emit('downloadProgress', {
                    speed: downloadSpeedLabel,
                    progress: progress
                });
            }
        });
        let lastUpProgress = 0;
        let lastUploadSpeed = 0;
        torrent.on('upload', bytes => {
            //Logger.trace('just uploaded: ' + bytes)
            //Logger.trace('total uploaded: ' + torrent.uploaded)

            const progressUp = torrent.uploaded / torrent.length * 100;//torrent.progress * 100;
            const uploadSpeed = torrent.uploadSpeed;
            if(progressUp !== lastUpProgress || uploadSpeed !== lastUploadSpeed) {
                lastUpProgress = progressUp;
                lastUploadSpeed = uploadSpeed;
                const uploadSpeedLabel = FileUtil.formatBytes(uploadSpeed) + '/sec';
                //Logger.trace('torrent.upload speed: ' + uploadSpeedLabel + ' ' + progressUp + ' t ' + torrent.progress + ' u ' + torrent.uploaded);
                scope.emitter.emit('uploadProgress', {
                    speed: uploadSpeedLabel,
                    progress: progressUp
                });
            }
        });
        torrent.on('metadata', () => scope.torrentAddition.metadata(torrent));
        torrent.on('infoHash', infoHash => scope.torrentAddition.infoHash(torrent, infoHash));
        torrent.on('noPeers', announceType => scope.torrentAddition.noPeers(torrent, announceType));
        torrent.on('warning', err => scope.torrentAddition.warning(torrent, err));
        torrent.on('wire', (wire, addr) => scope.torrentAddition.wire(wire, addr));


        this.emitter.emit('update', torrent);

        return torrent;
    }

    syncWithPhotoEvents() {
        this.emitter.on('photos', event => {

            if(event.type === 'add' && !event.item.seed) {
                //this.client.torrents
                const index = this.client.torrents.findIndex(item => item.infoHash === event.item.infoHash);
                if(index < 0) {

                    this.photos = update(this.photos, {$unshift: [event.item]});
                    this.torrentAddition.add(event.item.url, event.item.secure, false);
                }
            } else if(event.type === 'delete') {

                const index = this.client.torrents.findIndex(item => item.infoHash === event.item);
                if(index > -1) {
                    const torrent = this.client.torrents[index];
                    if(torrent) {
                        this.torrentDeletion.deleteTorrent(torrent).then(infoHash => {
                            Logger.info('deleteTorrent done ' + infoHash);
                        });
                    }
                    const photosIndex = this.photos.findIndex(item => item.infoHash === event.item);
                    this.photos = update(this.photos, {$splice: [[photosIndex, 1]]});
                }
            } else if(event.type === 'update') {

                const index = this.photos.findIndex(item => item.infoHash === event.item.peerId);
                if(index > -1) {
                    this.photos = update(this.photos, {$splice: [[index, 1, event.item]]});
                }
            }
        });
    }

    syncUiWithServerUrls(photos) {
        const scope = this;
        Logger.debug('photos.length: '+photos.length);

        if(!this.hasPeer) {
            return;
        }

        this.client.torrents.forEach(torrent => {
            const urlItem = this.findUrl(photos, torrent.infoHash);
            if(!urlItem) {
                scope.torrentDeletion.deleteTorrent(torrent).then(infoHash => {
                    //return this.emitter.emit('deletedTorrent', infoHash);
                    Logger.info('deleteTorrent done ' + infoHash);
                });

                this.emitter.emit('photos', {
                    type: 'delete', item: torrent.infoHash
                });
            }
        });

        photos.forEach(item => {
            //const metadata = window.parsetorrent(item.photo);
            const torrent = scope.client.get(item.infoHash);
            if(!torrent) {
                Logger.debug('new photo found on server');

                scope.torrentAddition.add(item.url, item.secure, item.sharedBy ? item.sharedBy : {});
                //this.emitter.emit('addedTorrent', item);
                this.emitter.emit('photos', {
                    type: 'add', item: item
                });
            }

            if(torrent && torrent.files && torrent.files.length < 1 && item.owners.find(owner => owner.peerId === this.client.peerId)) {
                this.service.removeOwner(item.infoHash, this.client.peerId)
            }
        });
    }

    findUrl(photos, infoHash) {
        const index = photos.findIndex(item => item.infoHash === infoHash);
        let foundItem = null;
        if(index => 0) {
            foundItem = photos[index];
        }
        return foundItem;
    }
}