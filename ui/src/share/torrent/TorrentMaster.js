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
import humanizeDuration from 'humanize-duration'
import MetadataParser from "../gallery/metadata/MetadataParser";
import { getTorrent, getBaseInfoHash, getFilePathFromInfoHash } from './WebTorrentUtils';
import { cacheGet, cachePut, shouldCacheBlob } from '../util/ImageBlobCache';
import ServerFallback from './ServerFallback';
import ConnectionRecovery from '../util/ConnectionRecovery';

export default class TorrentMaster {

    constructor(service, emitter) {

        const self = this;
        this.numPeers = 0;

        this.service = service;
        this.service.master = this;
        this.emitter = emitter;
        this.peers = new Peers(emitter, [], service);
        this.metadata = new MetadataParser(this);
        this.STREAMING_VIDEO_FORMATS = ['mp4', 'm4v', 'm4a'];
        this.STREAMING_AUDIO_FORMATS = ['mp3'];
        this.STREAMING_FORMATS = [...this.STREAMING_VIDEO_FORMATS, ...this.STREAMING_AUDIO_FORMATS];
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

        this.emitter.on('strategyPreference', value => {
            this.strategyPreference = value;
        });

        // The network panel mounts whenever it is opened, long after these
        // fire once, so keep the latest values for it to start from.
        this.emitter.on('localNetwork', chain => {
            if (Array.isArray(chain) && chain.length > 0) this.localNetwork = chain;
        });
        this.emitter.on('connectionSpeedType', type => {
            this.connectionSpeedType = type;
        });

        // Fallback tier: fetch the server copy when P2P stalls.
        this.serverFallback = new ServerFallback({
            fetchCopy: infoHash => this.service.fetchServerCopy ? this.service.fetchServerCopy(infoHash) : Promise.resolve(null),
            cachePut,
            emitter: this.emitter
        });

        // Phones freeze pages in background: on return, re-announce to
        // trackers, reopen SSE and re-sync anything missed while asleep.
        this._lastResumeAt = 0;
        this.connectionRecovery = new ConnectionRecovery({
            onResume: reason => this.handleResume(reason)
        });
        try { this.connectionRecovery.start(); } catch { /* non-browser env */ }

        this.emitter.on('sseReconnected', () => this.handleResume('sse'));
        this.emitter.on('fetchServerCopyNow', photo => { this.fetchServerCopyNow(photo).catch(() => {}); });
        this.emitter.on('retryTorrent', photo => { this.retryPhoto(photo).catch(err => Logger.warn('retryPhoto: ' + err)); });
    }

    /** User tapped "use server copy" on a stalled tile. */
    async fetchServerCopyNow(photo) {
        if (!photo?.infoHash || !this.serverFallback) return false;
        if (!this.serverFallback.watched.has(photo.infoHash)) {
            const torrent = getTorrent(this.client, getBaseInfoHash(photo.infoHash));
            this.serverFallback.watch(photo, () => torrent
                ? { progress: torrent.progress, done: torrent.done }
                : { progress: 0, done: false });
        }
        return this.serverFallback.fetchNow(photo.infoHash);
    }

    /** User tapped "retry connection": re-announce and re-add the torrent. */
    async retryPhoto(photo) {
        if (!photo?.infoHash) return false;
        try { this.restartTrackers(); } catch { /* trackers may not be ready */ }
        const baseInfoHash = getBaseInfoHash(photo.infoHash);
        const room = await this.service.getRoom();
        const photos = (room?.photos || [photo]).filter(item => getBaseInfoHash(item.infoHash) === baseInfoHash);
        const torrent = getTorrent(this.client, baseInfoHash);
        if (torrent) {
            await new Promise(resolve => {
                try { this.client.remove(baseInfoHash, () => resolve()); }
                catch { resolve(); }
            });
        }
        try {
            await this.torrentAddition.handlePhotoAddEvent(photos);
        } catch (err) {
            Logger.warn('retryPhoto add failed: ' + err);
        }
        return true;
    }

    handleResume(reason) {
        const now = Date.now();
        if (now - this._lastResumeAt < 2000) return; // visibility + online fire together
        this._lastResumeAt = now;
        Logger.info('ConnectionRecovery: resuming trackers and room sync');
        try { this.restartTrackers(); } catch (err) { Logger.warn('restartTrackers on resume: ' + err); }
        if (reason !== 'sse') {
            try { this.service.reconnectUpdates?.(); } catch { /* SSE already handled */ }
        }
        if (this.service.hasRoom && this.service.joinRoom) {
            this.findExistingContent(this.service.joinRoom).catch(err => Logger.warn('resume re-sync failed: ' + err));
        }
    }

    /**
     * Fetch a room, publish its peers and cached photos, then restore local torrents
     * and start reconciling downloads and ownership. `roomPromise` is a function
     * invoked with the room service as `this`, not an already-created promise.
     * Resolve with the room's photos, or undefined for a falsy response. Room-request
     * and torrent-store iteration failures reject; photo publication can precede failure.
     */
    async findExistingContent(roomPromise) {

        const requestedAt = Date.now();
        return roomPromise.call(this.service)
            .then(async response => {

                if(!response) return;

                const peers = this.peers.items = response.peers;
                this.peers.connections = response.connections;
                this.emitter.emit('peers', {type: 'all', item: peers});

                const photos = response.photos;
                Logger.info(`photos: ${photos.length} peers ${peers.length}`);

                // Pre-populate photos from blob cache so they render immediately
                // without waiting for WebTorrent resurrection
                await this.serveCachedPhotos(photos);

                // Show the room now: re-adding every torrent can take a while
                // on a phone, and the gallery used to sit empty until it was done.
                this.roomSynced = true;
                this.emitter.emit('photos', {type: 'all', item: photos, requestedAt});

                const values = await this.resurrectLocallySavedTorrents(photos);
                Logger.info('done with resurrectAllTorrents ' + values);

                this.syncUiWithServerUrls(photos, requestedAt);

                this.fillMissingOwners(photos);

                return response.photos;
            });
    }

    /**
     * Check the blob cache for each photo and pre-populate image data
     * so photos render immediately on page reload without waiting for
     * WebTorrent peer/tracker connectivity.
     */
    async serveCachedPhotos(photos) {
        await Promise.all(photos.map(photo => this.serveCachedPhoto(photo)));
    }

    /**
     * Populate an image photo in place from its cached blob and mark it loaded.
     * Reuse the retained File and blob URL on later lookups of the same infoHash.
     * Missing hashes, non-image types, and cache misses are skipped; cache and blob
     * preparation errors are swallowed. Resolves without a value.
     */
    async serveCachedPhoto(photo) {
        if (!photo.infoHash) return;
        if (!shouldCacheBlob(photo.fileType)) return;
        try {
            // Resume re-syncs the room each time the phone wakes; reuse the
            // URL so the gallery doesn't reload every image.
            this._cachedPhotos = this._cachedPhotos || new Map();
            let cached = this._cachedPhotos.get(photo.infoHash);
            if (!cached) {
                const blob = await cacheGet(photo.infoHash);
                if (!blob) return;
                const file = new File([blob], photo.fileName || 'image', {
                    type: photo.fileType || blob.type
                });
                cached = { file, img: URL.createObjectURL(file) };
                this._cachedPhotos.set(photo.infoHash, cached);
            }
            const file = cached.file;
            photo.fromCache = true;
            photo.cachedFile = file;
            photo.img = cached.img;
            photo.elem = file;
            photo.loading = false;
            photo.fileSize = photo.fileSize || (file.size ? FileUtil.formatBytes(file.size) : '');
            photo.isImage = (photo.fileType || '').includes('image/');
            photo.isVideo = (photo.fileType || '').includes('video/');
            photo.isAudio = (photo.fileType || '').includes('audio/');
            Logger.info('serveCachedPhotos: served from cache ' + photo.fileName);
        } catch (e) {
            Logger.debug('serveCachedPhotos: cache miss for ' + photo.infoHash);
        }
    }

    fillMissingOwners(photos) {

        return new Promise((resolve, reject) => {
            const toBeAdded = photos
                .map(item => this.fillMissingOwnersItem(item))
                .filter(item => item);

            if(toBeAdded && toBeAdded.length > 0) {
                this.service.addOwner(toBeAdded).then(result => {
                    Logger.warn('found missing owners and filled ' + result);
                    resolve(result)
                }).catch(err => {
                    Logger.error('Error adding owners: ' + err);
                    reject(err);
                });
            } else {
                // No missing owners to fill, resolve immediately
                resolve([]);
            }
        });
    }

    fillMissingOwnersItem(item) {
        //check for missing owners - can happen after re-connections.
        const peerId = this.client.peerId;
        const torrent = getTorrent(this.client, item.infoHash);
        // Check that torrent exists, has files array, and files array has items
        const isOwner = torrent && torrent.files && torrent.files.length > 0;
        if(isOwner) {
            const found = item.owners && item.owners.find(owner => owner.peerId === peerId);
            if(!found) {
                return {
                    infoHash: item.infoHash,
                    peerId: peerId,
                    loading: false
                }
            }
        }
        return null;
    }

    //more on the approach: https://github.com/SilentBot1/webtorrent-examples/blob/master/resurrection/index.js
    /**
     * Scan saved metadata and start restoring torrents against the room photos.
     * Return a promise for the scan; individual restoration rejections are caught,
     * while database iteration errors reject.
     */
    resurrectLocallySavedTorrents(photos) {
        //Iterates through all metadata from metadata store and attempts to resurrect them!
        const self = this;

        return new Promise((resolve, reject) => {

            let loopResolve;
            const loopPromise = new Promise(r => { loopResolve = r; });

            const allPendingTorrents = [loopPromise];
            self.torrentsDb.iterator((err, cursor) => {
                if(err) {
                    reject(err);
                    return;
                }
                if(cursor) {
                    if(typeof cursor.value === 'object'){
                        // One torrent that can't come back must not hold up the rest.
                        allPendingTorrents.push(self.resurrectTorrent(cursor.value, photos).catch(err => {
                            Logger.warn('resurrectTorrent failed: ' + err);
                            return false;
                        }));
                    }
                    cursor.continue()
                } else {
                    // Iterator finished — resolve the loop sentinel so Promise.all can proceed
                    loopResolve(true);
                }
            });

            Promise.all(allPendingTorrents).then(values => {
                Logger.info('resurrectAllTorrents ' + values);
                values.shift();
                resolve(values);
            }).catch(reject);
        });
    }

    /**
     * Restore saved metadata for photos matching its base infoHash, including
     * compound file IDs. Mark matching photos as rendering from cache.
     * Resolve with the supplied metadata if already active, the added torrent,
     * or false after starting deletion when no room photo matches. Deletion errors
     * are caught; addition promise rejections reject with descriptive strings.
     * Non-object or null metadata rejects with false. If photos are omitted for an
     * inactive torrent, the promise stays pending.
     */
    resurrectTorrent(metadata, photos){
        const self = this;

        return new Promise((resolve, reject) => {

            if(typeof metadata === 'object' && metadata != null) {
                const existingTorrent = getTorrent(self.client, metadata.infoHash);
                
                if(existingTorrent) {

                    Logger.info('resurrectTorrent.client.get ' + metadata.name);
                    resolve(metadata);

                } else {

                    if(photos) {
                        // Photos of a multi-file upload are listed as "<infoHash>-<path>".
                        const matching = photos.filter(item => getBaseInfoHash(item.infoHash) === metadata.infoHash);
                        if(matching.length > 0) {
                            matching.forEach(photo => {
                                photo.rendering = true;
                                photo.fromCache = true;
                            });
                            const paths = matching.length > 1
                                ? matching.map(photo => getFilePathFromInfoHash(photo.infoHash))
                                : undefined;

                            self.torrentAddition._add(metadata, matching, true, paths).then(torrent => {

                                if(!torrent) {
                                    Logger.error('resurrectTorrent.add no torrent');
                                } else {
                                    Logger.info('resurrectTorrent.add ' + torrent.infoHash);
                                }
                                resolve(torrent);

                            }, error => {
                                const msg = 'error, failed to resurrect ' + metadata.infoHash + ': ' + error;
                                Logger.error(msg);
                                reject(msg);
                            });

                        } else {
                            //delete any local photos not found on server.
                            self.torrentDeletion.deleteTorrent(metadata).catch(err => Logger.warn('deleteTorrent: ' + err));
                            resolve(false);
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
        this.service.updateOwner([{
            infoHash: infoHash,
            peerId: this.client.peerId,
            progress: progress
        }]);
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

        const opts = {'announce': window.WEBTORRENT_ANNOUNCE, private: true};
        opts.store = idb;
        let validInput = input;
        
        if(addOrSeed === 'seed') {
            // Handle FileList objects (from input[type="file"])
            if(input && typeof input[Symbol.iterator] === 'function' && !Array.isArray(input) && !(input instanceof File) && !(input instanceof Blob)) {
                // Convert iterable (like FileList) to array
                try {
                    validInput = Array.from(input);
                } catch(e) {
                    Logger.error('Failed to convert input to array: ' + e);
                    const error = new Error('Invalid torrent identifier: cannot convert input to array');
                    if(callback) {
                        callback(null, error);
                    }
                    return null;
                }
            }
            
            // Ensure input is an array and filter out any invalid items
            if(Array.isArray(validInput)) {
                // Filter out invalid items and ensure all are File objects
                validInput = validInput.filter(item => {
                    return item && (item instanceof File || item instanceof Blob);
                });
                
                if(validInput.length === 0) {
                    const error = new Error('No valid files to seed');
                    Logger.error(error.message);
                    if(callback) {
                        callback(null, error);
                    }
                    return null;
                }
                
                // Filter out thumbnails for strategy determination (thumbnails are identified by name prefix)
                const filesArr = validInput.filter(item => {
                    if(item instanceof File) {
                        return !item.name.startsWith('Thumbnail ');
                    }
                    return true;
                });
                
                if(filesArr.length > 0 && filesArr.every(file => {
                    // Check if file has type property and it's not a video
                    return file.type && !file.type.includes('video/');
                })) {
                    opts.strategy = this.strategyPreference ? 'sequential' : 'rarest';
                    //opts.strategy = 'rarest';
                }
            } else if(validInput && (validInput instanceof File || validInput instanceof Blob)) {
                // Single File or Blob is valid
                // No need to change validInput
            } else if(!validInput) {
                // Input is null, undefined, or falsy
                const error = new Error('Invalid torrent identifier: input is null or undefined');
                Logger.error(error.message);
                if(callback) {
                    callback(null, error);
                }
                return null;
            } else {
                // If input is not a valid file/blob and not an array, it's invalid
                const error = new Error('Invalid torrent identifier: input must be a File, Blob, or array of Files/Blobs');
                Logger.error(error.message);
                if(callback) {
                    callback(null, error);
                }
                return null;
            }
        } else if(addOrSeed === 'add' && input && input.files) {

            this.torrentAddition.defineStrategy(input.files, opts);
        }
        
        const torrent = this.client[addOrSeed](validInput, opts, callback);
        //const torrent = this.client[addOrSeed](uri, { 'announce': window.WEBTORRENT_ANNOUNCE}, callback);

        if(torrent) {
            Logger.info('addSeedOrGetTorrent ' + torrent.infoHash + ' ' + torrent.name);
        } else {
            Logger.warn('addSeedOrGetTorrent returned null/undefined torrent');
            return null;
        }

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
            const timeRemaining = humanizeDuration(Math.round(torrent.timeRemaining));
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
                    const infoHash = torrent.infoHash;
                    debouncedServerPublish(infoHash, progress);
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

        this.emitter.emit('newTorrent', torrent);

        return torrent;
    }

    syncWithPhotoEvents() {
        this.emitter.on('photos', event => {

            if(event.type === 'add') {

                this.torrentAddition.handlePhotoAddEvent(event.item);

            } else if(event.type === 'delete') {

                this.torrentDeletion.handlePhotoDeleteEvent(event.item);
                this.serverFallback?.unwatch(typeof event.item === 'string' ? event.item : event.item?.infoHash);
            } else if(event.type === 'update') {
                // A server copy may appear after we already started (and
                // stalled on) the P2P download - start watching it then.
                const items = Array.isArray(event.item) ? event.item : [event.item];
                items.filter(item => item?.hasServerCopy).forEach(item => {
                    const torrent = getTorrent(this.client, getBaseInfoHash(item.infoHash));
                    if (torrent && this.client.peerId !== item.peerId) {
                        this.serverFallback?.watch(item, () => ({ progress: torrent.progress, done: torrent.done }));
                    }
                });
            }
        });
    }

    /**
     * Start adding missing room torrents and deleting local torrents absent from
     * the snapshot, matching compound photo IDs by base hash. Protect uploads still
     * hashing or unconfirmed as of `requestedAt` (epoch milliseconds); omitting it
     * also protects uploads with tracked confirmations. Return without waiting;
     * asynchronous add/delete rejections are caught.
     */
    syncUiWithServerUrls(photos, requestedAt) {
        const self = this;
        Logger.debug('syncUiWithServerUrls photos.length: '+photos.length);

        this.client.torrents.forEach(torrent => {
            // Still hashing (no infoHash yet) or an upload the server hasn't
            // confirmed: the snapshot just predates it.
            if(!torrent.infoHash || this.torrentAddition?.isUnconfirmedLocalShare?.(torrent, requestedAt)) {
                return;
            }
            const urlItem = this.findUrl(photos, torrent.infoHash);
            if(!urlItem) {
                self.torrentDeletion.deleteTorrent(torrent).then(infoHash => {
                    Logger.info('deleteTorrent done ' + infoHash);
                }).catch(err => Logger.warn('deleteTorrent: ' + err));
            }
        });

        photos.forEach(item => {
            // Extract base infoHash (without file path suffix) for client.get()
            const baseInfoHash = getBaseInfoHash(item.infoHash);
            const torrent = getTorrent(self.client, baseInfoHash);
            
            if(!torrent) {
                Logger.debug('syncUiWithServerUrls adding torrent: ' + baseInfoHash);

                self.torrentAddition.add(baseInfoHash || item.infoHash, item).then(result => {
                    Logger.debug('syncUiWithServerUrls add success: ' + (result ? result.infoHash : 'null'));
                }).catch(err => {
                    Logger.warn('syncUiWithServerUrls add failed: ' + err);
                });
            }

            /*if(torrent && torrent.files && torrent.files.length < 1 && item.owners.find(owner => owner.peerId === this.client.peerId)) {
                this.service.removeOwner(item.infoHash, this.client.peerId)
            }*/
        });
    }

    /** Return the first photo matching an exact ID or base torrent hash, or null. */
    findUrl(photos, infoHash) {
        // Photos of a multi-file torrent are listed as "<infoHash>-<path>".
        const index = photos.findIndex(item => item.infoHash === infoHash
            || getBaseInfoHash(item.infoHash) === infoHash);
        let foundItem = null;
        if(index >= 0) {
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

    leaveRoomAndReload() {
        const location = window.location;
        window.history.replaceState({}, '', decodeURIComponent(`${location.pathname}`));
        location.reload();
    }

    reload() {
        const location = window.location;
        location.reload();
    }
}