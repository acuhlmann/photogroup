import Logger from 'js-logger';

import IdbKvStore from 'idb-kv-store';
import Peers from '../topology/Peers';
import idb from 'indexeddb-chunk-store';
import TorrentAddition from './TorrentAddition';
import TorrentDeletion from "./TorrentDeletion";
import TorrentCreator from "./TorrentCreator";
import FileUtil from '../util/FileUtil';
import platform from 'platform';
import _ from 'lodash';
import moment from 'moment';

export default class TorrentMaster {

    constructor(service, emitter) {

        const self = this;
        this.numPeers = 0;

        this.service = service;
        this.service.master = this;
        this.emitter = emitter;
        this.peers = new Peers(emitter, [], service);
        this.torrentsDb = new IdbKvStore('torrents');
        this.torrentsDb.on('open',() => {
            Logger.info('torrentsDb open');
        });
        this.torrentsDb.on('close',() => {
            Logger.info('torrentsDb close');
        });
        this.torrentsDb.on('error',(err) => {
            Logger.error('torrentsDb error ' + err);
        });
        this.torrentAddition = new TorrentAddition(this.service, this.torrentsDb, this.emitter, this);
        this.torrentDeletion = new TorrentDeletion(this.service, this.torrentsDb, this.emitter, this);

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

                const peers = this.peers.items = response.peers;
                this.peers.connections = response.connections;
                this.emitter.emit('peers', {type: 'all', item: peers});

                const photos = response.photos;
                Logger.info(`photos: ${photos.length} peers ${peers.length}`);
                const values = await this.resurrectLocallySavedTorrents(photos);
                Logger.info('done with resurrectAllTorrents ' + values);
                /*Promise.all(values).then(results => {
                    Logger.info('all done with resurrectAllTorrents ' + results);
                });*/

                //this.hasPeer = true;

                this.syncUiWithServerUrls(photos);
                this.emitter.emit('photos', {type: 'all', item: photos});


                /*let foundAnyMissing;
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
                }*/

                return response.photos;
            });
    }

    /*fillMissingOwners(item) {
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
    }*/

    //more on the approach: https://github.com/SilentBot1/webtorrent-examples/blob/master/resurrection/index.js
    resurrectLocallySavedTorrents(photos) {
        //Iterates through all metadata from metadata store and attempts to resurrect them!
        const self = this;

        return new Promise((resolve, reject) => {

            const loopResolver = value => {};
            const loopPromise = new Promise(loopResolver);

            const allPendingTorrents = [loopPromise];
            self.torrentsDb.iterator((err, cursor) => {
                if(err) {
                    reject(err);
                }
                if(cursor) {
                    if(typeof cursor.value === 'object'){
                        allPendingTorrents.push(self.resurrectTorrent(cursor.value, photos));
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
        const self = this;

        return new Promise((resolve, reject) => {

            if(typeof metadata === 'object' && metadata != null) {
                if(self.client.get(metadata.infoHash)) {

                    Logger.info('resurrectTorrent.client.get ' + metadata.name);
                    resolve(metadata);

                } else {

                    if(photos) {
                        const photo = photos.find(item => item.infoHash === metadata.infoHash);
                        if(photo) {
                            photo.rendering = true;

                            self.torrentAddition.add(metadata, false, true).then(torrent => {

                                Logger.info('resurrectTorrent.add ' + torrent.infoHash);
                                resolve(torrent);

                            }, error => {
                                const msg = 'error, failed to resurrect ' + JSON.stringify(arguments);
                                Logger.error(msg);
                                reject(msg);
                            });

                        } else {
                            //delete any local photos not found on server.
                            self.torrentDeletion.deleteTorrent(metadata);
                        }
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

    publishLoadingStatus(infoHash, progress) {
        //console.log('publishLoadingStatus: ' + progress);
        this.service.updateOwner(infoHash, {
            peerId: this.client.peerId,
            progress: progress
        });
    }

    sendDownloadEvent(emitter, torrent, downloadSpeedLabel, progress, timeRemaining) {
        emitter.emit('downloadProgress', {
            torrent: torrent,
            speed: downloadSpeedLabel,
            progress: progress, timeRemaining: timeRemaining
        });
    }

    sendUploadEvent(emitter, torrent, uploadSpeedLabel, progressUp) {
        emitter.emit('uploadProgress', {
            torrent: torrent,
            speed: uploadSpeedLabel,
            progress: progressUp
        });
    }

    addSeedOrGetTorrent(addOrSeed, input, callback) {

        const opts = {'announce': window.WEBTORRENT_ANNOUNCE};
        opts.store = idb;
        const torrent = this.client[addOrSeed](input, opts, callback);
        //const torrent = this.client[addOrSeed](uri, { 'announce': window.WEBTORRENT_ANNOUNCE}, callback);

        Logger.info('addSeedOrGetTorrent ' + torrent.infoHash + ' ' + torrent.name);

        const self = this;
        const debouncedServerPublish = _.throttle(self.publishLoadingStatus.bind(self), 1000,
            { 'leading': true, 'trailing': false });
        const debouncedDownload = _.throttle(self.sendDownloadEvent.bind(self), 200,
            { 'leading': true, 'trailing': false });

        let lastProgress = 0;
        let lastDownloadSpeed = 0;
        torrent.on('download', bytes => {
            //Logger.trace('just downloaded: ' + bytes)
            //Logger.trace('total downloaded: ' + torrent.downloaded)
            const timeRemaining = moment
                .duration(Math.round(torrent.timeRemaining / 1000), 'seconds')
                .humanize(true);
            //console.log('total timeRemaining: ' + timeRemaining);
            const progress = Math.round(torrent.progress * 100);
            const downloadSpeed = Math.round(torrent.downloadSpeed);
            const progressChange = progress !== lastProgress;
            if(progressChange || downloadSpeed !== lastDownloadSpeed) {
                lastProgress = progress;
                lastDownloadSpeed = downloadSpeed;
                const downloadSpeedLabel = FileUtil.formatBytes(downloadSpeed) + '/sec';
                //Logger.trace('torrent.download speed: ' + downloadSpeedLabel + ' ' + progress);

                if(progressChange) {
                    debouncedServerPublish(torrent.infoHash, progress);
                }

                debouncedDownload(self.emitter, torrent, downloadSpeedLabel, progress, timeRemaining);
            }
        });

        const debouncedUpload = _.throttle(self.sendUploadEvent.bind(self), 200,
            { 'leading': true, 'trailing': false });

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

                debouncedUpload(self.emitter, torrent, uploadSpeedLabel, progressUp);
            }
        });
        torrent.on('metadata', () => self.torrentAddition.metadata(torrent));
        torrent.on('infoHash', infoHash => self.torrentAddition.infoHash(torrent, infoHash));
        torrent.on('noPeers', announceType => self.torrentAddition.noPeers(torrent, announceType));
        torrent.on('warning', err => self.torrentAddition.warning(torrent, err));
        torrent.on('wire', (wire, addr) => self.torrentAddition.wire(wire, addr, torrent));

        this.emitter.emit('update', torrent);

        return torrent;
    }


    syncWithPhotoEvents() {
        this.emitter.on('photos', event => {

            if(event.type === 'add' && !event.item.seed) {
                const index = this.client.torrents.findIndex(item => item.infoHash === event.item.infoHash);
                if(index < 0) {

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
                }
            }
        });
    }

    syncUiWithServerUrls(photos) {
        const self = this;
        Logger.debug('photos.length: '+photos.length);

        this.client.torrents.forEach(torrent => {
            const urlItem = this.findUrl(photos, torrent.infoHash);
            if(!urlItem) {
                self.torrentDeletion.deleteTorrent(torrent).then(infoHash => {
                    Logger.info('deleteTorrent done ' + infoHash);
                });
            }
        });

        photos.forEach(item => {
            const torrent = self.client.get(item.infoHash);
            if(!torrent) {
                Logger.debug('new photo found on server');

                self.torrentAddition.add(item.url, item.secure, item.sharedBy ? item.sharedBy : {});
            }

            /*if(torrent && torrent.files && torrent.files.length < 1 && item.owners.find(owner => owner.peerId === this.client.peerId)) {
                this.service.removeOwner(item.infoHash, this.client.peerId)
            }*/
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

    restartTrackers() {
        this.client.torrents.forEach(torrent => {

            const isReady = torrent.discovery && torrent.discovery.tracker
                && torrent.discovery.tracker._trackers && torrent.discovery.tracker._trackers.length > 0;
            if(isReady) {

                const trackers = torrent.discovery.tracker._trackers;

                //Logger.info('torrent trackers ready ' + trackers.length);

                trackers.forEach(tracker => {
                    const announceUrl = tracker.announceUrl;
                    Logger.warn('restartTrackers ' + announceUrl);
                    tracker._openSocket();
                });
            }
        });
    }
}