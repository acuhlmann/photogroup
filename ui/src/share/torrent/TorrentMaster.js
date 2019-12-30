import Logger from 'js-logger';

import IdbKvStore from 'idb-kv-store';
//TODO: fails in create-create-app build
//import parsetorrent from 'parse-torrent';
import idb from 'indexeddb-chunk-store';
import TorrentAddition from "./TorrentAddition";
import TorrentDeletion from "./TorrentDeletion";
import TorrentCreator from "./TorrentCreator";
import FileUtil from '../util/FileUtil';

/**
 * @emits TorrentMaster#deleted
 * @type {string} magnetURI
 */
export default class TorrentMaster {

    constructor(service, emitter) {

        const scope = this;
        this.numPeers = 0;

        this.service = service;
        this.service.master = this;
        this.service.emitter.on('urls', urls => {
            scope.urls = urls;
            scope.syncUiWithServerUrls(urls);
        });

        emitter.on('webPeers', peers => {

            if(!scope.client || !scope.client.peerId || !peers) return;

            const peerId = scope.client.peerId;
            scope.me = peers.find(peer => peer.peerId === peerId);

            if(peers && scope.urls) {
                peers.forEach(peer => {
                    scope.urls.forEach(url => {
                        if(url.sharedBy.peerId === peer.peerId) {
                            url.sharedBy.name = peer.name;
                        }
                    })
                });
            }
        });
        this.emitter = emitter;

        this.torrentsDb = new IdbKvStore('torrents');
        this.torrentAddition = new TorrentAddition(this.service, this.torrentsDb, this.emitter, this);
        this.torrentDeletion = new TorrentDeletion(this.service, this.torrentsDb, this.emitter);

        this.creator = new TorrentCreator(service, emitter, this, this.torrentAddition);
        this.creator.start();
        TorrentCreator.setupAnnounceUrls();
    }

    get client() {
        return this.creator.client;
    }

    addSeedOrGetTorrent(addOrSeed, uri, callback) {

        const torrent = this.client[addOrSeed](uri, { 'announce': window.WEBTORRENT_ANNOUNCE, 'store': idb }, callback);
        //const torrent = this.client[addOrSeed](uri, { 'announce': window.WEBTORRENT_ANNOUNCE}, callback);

        Logger.info('addSeedOrGetTorrent ' + torrent.infoHash);

        const scope = this;
        let lastProgress = 0;
        let lastDownloadSpeed = 0;
        torrent.on('download', bytes => {
            //Logger.log('just downloaded: ' + bytes)
            //Logger.log('total downloaded: ' + torrent.downloaded)
            const progress = torrent.progress * 100;
            const downloadSpeed = torrent.downloadSpeed;
            if(progress !== lastProgress || downloadSpeed !== lastDownloadSpeed) {
                lastProgress = progress;
                lastDownloadSpeed = downloadSpeed;
                const downloadSpeedLabel = FileUtil.formatBytes(downloadSpeed) + '/sec';
                //Logger.log('torrent.download speed: ' + downloadSpeedLabel + ' ' + progress);
                scope.emitter.emit('downloadProgress', {
                    speed: downloadSpeedLabel,
                    progress: progress
                });
            }
        });
        let lastUpProgress = 0;
        let lastUploadSpeed = 0;
        torrent.on('upload', bytes => {
            //Logger.log('just uploaded: ' + bytes)
            //Logger.log('total uploaded: ' + torrent.uploaded)

            const progressUp = torrent.uploaded / torrent.length * 100;//torrent.progress * 100;
            const uploadSpeed = torrent.uploadSpeed;
            if(progressUp !== lastUpProgress || uploadSpeed !== lastUploadSpeed) {
                lastUpProgress = progressUp;
                lastUploadSpeed = uploadSpeed;
                const uploadSpeedLabel = FileUtil.formatBytes(uploadSpeed) + '/sec';
                //Logger.log('torrent.upload speed: ' + uploadSpeedLabel + ' ' + progressUp + ' t ' + torrent.progress + ' u ' + torrent.uploaded);
                scope.emitter.emit('uploadProgress', {
                    speed: uploadSpeedLabel,
                    progress: progressUp
                });
            }
        });
        torrent.on('metadata', () => scope.torrentAddition.metadata(torrent));
        torrent.on('infoHash', hash => scope.torrentAddition.infoHash(torrent, hash));
        torrent.on('noPeers', announceType => scope.torrentAddition.noPeers(torrent, announceType));
        torrent.on('warning', err => scope.torrentAddition.warning(torrent, err));
        torrent.on('wire', (wire, addr) => scope.torrentAddition.wire(wire, addr));


        this.emitter.emit('update', torrent);

        return torrent;
    }

    async findExistingContent(roomPromise, newRoom) {

        const self = this;

        return roomPromise.call(this.service)
            .then(async response => {

                if(!response) return;

                const urls = this.urls = response.urls;
                const values = await this.resurrectLocallySavedTorrents(this.urls);
                Logger.info('done with resurrectAllTorrents ' + values);

                let foundAnyMissing;
                let msg = response.urls.length + '\n';
                urls.forEach(item => {
                    item.sharedBy = item.sharedBy || {};

                    if(this.fillMissingOwners(item)) {
                        foundAnyMissing = true;
                    }

                    msg += item.hash + ' '  + item.secure + ' ' + item.sharedBy.originPlatform + ' ' + item.sharedBy.ips + '\n';
                });
                Logger.info('current server sent Urls: ' + msg);

                this.hasPeer = true;

                if(!foundAnyMissing) {
                    self.emitter.emit('urls', response.urls);
                }

                return response.urls;
            });
    }

    fillMissingOwners(item) {
        let foundAnyMissing;
        //check for missing owners - can happen after re-connections.
        const peerId = this.client.peerId;
        const torrent = this.client.get(item.hash);
        const isOwner = torrent && torrent.files.length > 0;
        if(isOwner) {
            const found = item.owners.find(owner => owner.peerId === peerId);
            if(!found) {
                foundAnyMissing = true;
                this.service.addOwner(item.hash, peerId);
            }
        }
        return foundAnyMissing
    }

    syncUiWithServerUrls(urls) {
        const scope = this;
        Logger.debug('urls.length: '+urls.length);

        if(!this.hasPeer) {
            return;
        }

        this.client.torrents.forEach(torrent => {
            const urlItem = this.findUrl(urls, torrent.infoHash);
            if(!urlItem) {
                scope.torrentDeletion.deleteTorrent(torrent).then(infoHash => {
                    return this.emitter.emit('deletedTorrent', infoHash);
                });
            }
        });

        urls.forEach(item => {
            //const metadata = window.parsetorrent(item.url);
            const torrent = scope.client.get(item.hash);
            if(!torrent) {
                Logger.debug('new url found on server');

                scope.torrentAddition.add(item.url, item.secure, item.sharedBy ? item.sharedBy : {});
                this.emitter.emit('addedTorrent', item);
            }

            if(torrent && torrent.files && torrent.files.length < 1 && item.owners.find(owner => owner.peerId === this.client.peerId)) {
                this.service.removeOwner(item.hash, this.client.peerId)
            }
        });
    }

    findUrl(urls, hash) {
        const index = urls.findIndex(item => item.hash === hash);
        let foundItem = null;
        if(index => 0) {
            foundItem = urls[index];
        }
        return foundItem;
    }

    //more on the approach: https://github.com/SilentBot1/webtorrent-examples/blob/master/resurrection/index.js
    resurrectLocallySavedTorrents(urls) {
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
                        allPendingTorrents.push(scope.resurrectTorrent(cursor.value, urls));
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

    resurrectTorrent(metadata, urls){
        const scope = this;

        return new Promise((resolve, reject) => {

            if(typeof metadata === 'object' && metadata != null) {
                if(scope.client.get(metadata.infoHash)) {

                    Logger.info('resurrectTorrent.client.get ' + metadata.name);
                    resolve(metadata);

                } else {

                    let sharedBy = {};
                    let url;
                    if(urls) {
                        url = urls.find(item => item.hash === metadata.infoHash);
                        sharedBy = url ? url.sharedBy : sharedBy;
                    }
                    scope.torrentAddition.add(metadata, false, sharedBy).then(torrent => {

                        Logger.info('resurrectTorrent.add ' + torrent.infoHash);
                        resolve(torrent);

                    }, error => {
                        const msg = 'error, failed to resurrect ' + JSON.stringify(arguments);
                        Logger.error(msg);
                        reject(msg);
                    });
                    if(url) {
                        //this.emitter.emit('addedTorrent', url);
                    }
                }

            } else {
                reject(false);
            }
        });
    }

}