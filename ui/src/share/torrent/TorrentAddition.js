import Logger from 'js-logger';
import shortid  from 'shortid';
import StringUtil from "../util/StringUtil";
import {format} from 'date-fns';
import _ from 'lodash';
import FileUtil from "../util/FileUtil";
import React from "react";
import { getTorrent, getBaseInfoHash, getFilePathFromInfoHash, isDuplicateTorrentError, extractDuplicateTorrentId } from './WebTorrentUtils';
import { extractThumbnails } from './ThumbnailExtractor';
import { cachePut, shouldCacheBlob } from '../util/ImageBlobCache';
import { fingerprintFile } from '../gallery/fingerprint';
import { rememberHave } from '../gallery/alreadyHave';
import parseTorrent from 'parse-torrent';

/** Read a torrent file into a Blob with either WebTorrent API; null when neither exists. */
export function readFileBlob(file) {
    if (typeof file.blob === 'function') return file.blob();
    if (typeof file.getBlob !== 'function') return Promise.resolve(null);
    return new Promise((resolve, reject) => {
        file.getBlob((err, blob) => err ? reject(err) : resolve(blob));
    });
}

export default class TorrentAddition {

    /** Initialize torrent services and upload confirmation tracking, and subscribe to rendered photos. */
    constructor(service, torrentsDb, emitter, master) {
        this.service = service;
        this.torrentsDb = torrentsDb;
        this.emitter = emitter;
        this.master = master;
        // Torrents we are seeding that the server hasn't confirmed yet (they
        // have no infoHash while hashing), then infoHash -> confirmation time.
        this.pendingSeeds = new Set();
        this.shareStates = new Map();

        emitter.on('photoRendered', this.updatePhotoThatRendered, this);
    }

    /**
     * A room snapshot requested at `requestedAt` may not list an upload we
     * shared after (or are still sharing): don't treat that as a deletion.
     * Return true while seeding is pending or confirmation is at/after the
     * snapshot request. `requestedAt` is epoch milliseconds; omitting it
     * protects any upload with a tracked confirmation.
     */
    isUnconfirmedLocalShare(torrent, requestedAt) {
        if(this.pendingSeeds.has(torrent)) return true;
        const sharedAt = torrent.infoHash && this.shareStates.get(torrent.infoHash);
        if(sharedAt === undefined) return false;
        return sharedAt === 0 || !requestedAt || sharedAt >= requestedAt;
    }

    async updatePhotoThatRendered(photo) {

        const toBeShared = this.stripClientOnlyPhotoFields([photo]);

        const result = await this.master.service.update(toBeShared);
        Logger.info('fully rendered, update photo ' + result.length + ' '
            + result.map(item => item.fileName));
        
        // Clear rendering flag when photo is fully rendered
        photo.rendering = false;
        this.emitter.emit('photos', {type: 'update', item: [photo]});
    }

    handlePhotoAddEvent(serverPhotos) {

        if(serverPhotos.some(item => item.isFake)) {
            return;
        }

        if(serverPhotos.length > 1) {
            const torrentId = getBaseInfoHash(serverPhotos[0].infoHash);
            const torrent = getTorrent(this.master.client, torrentId);
            
            if(!torrent) {
                return this._add(torrentId, serverPhotos, false, serverPhotos.map(photo => getFilePathFromInfoHash(photo.infoHash)));
            }
        } else if(serverPhotos.length === 1) {
            const photo = serverPhotos[0];
            return this.add(getBaseInfoHash(photo.infoHash), photo);
        }
    }

    add(torrentId, photo, fromCache) {
        // Extract base infoHash (without file path suffix)
        const baseInfoHash = getBaseInfoHash(photo.infoHash);
        const torrent = getTorrent(this.master.client, baseInfoHash);
        
        return new Promise((async (resolve, reject) => {

            if(photo.isFake) {
                reject('Is fake tile for perceived performance.');
                return;
            }

            if(!torrent) {
                try {
                    const result = await this._add(torrentId, [photo], fromCache);
                    resolve(result);
                } catch(e) {
                    Logger.error('TorrentAddition.add error: ' + e);
                    reject(e);
                }
            } else {
                reject(false);
            }
        }));
    }

    _add(torrentId, photos, fromCache, paths) {

        Logger.info('add ' + torrentId + ' len ' + photos.length);


        const torrent = this.master.addSeedOrGetTorrent('add', torrentId, torrent => {
            Logger.info('_add done ' + torrent.name);
        });

        // If P2P stalls, ServerFallback asks for a server copy and delivers it.
        if (torrent && this.master.serverFallback) {
            photos.forEach(photo => {
                this.master.serverFallback.watch(photo, () => ({
                    progress: torrent.progress, received: torrent.received, done: torrent.done,
                    ...this.master.copyState?.(photo.infoHash)
                }));
            });
        }

        const self = this;
        return new Promise((resolve, reject) => {

            torrent.on('metadata', () => {

                Logger.info('add metadata ' + torrent.name);

                //const files = fromCache ? torrent.files.filter(item => !item.name.startsWith('Thumbnail ')) : torrent.files;
                const files = torrent.files;
                photos = photos.map((photo, index) => {

                    if(paths) {

                        if(!photo.secure) {
                            let localFiles = files;
                            if(photo.isAudio) {
                                localFiles = torrent.files;
                            }
                            const pathParts = paths[index].split('/');
                            photo.torrentFileThumb = localFiles
                                .find(file => file.path === pathParts[0] + '/' + 'Thumbnail ' + pathParts[1]);
                            photo.torrentFile = files.find(file => file.path === paths[index]);
                            
                            // Fallback: if no match by path, try by name
                            if (!photo.torrentFile) {
                                photo.torrentFile = files.find(file => file.name === photo.fileName);
                            }
                            // Fallback: find any non-thumbnail file
                            if (!photo.torrentFile) {
                                photo.torrentFile = files.find(file => !file.name.startsWith('Thumbnail '));
                            }
                        } else {
                            photo.torrentFile = files.find(file => file.path === paths[index]);
                        }
                        
                        // Final fallback for paths case
                        if (!photo.torrentFile && files.length > 0) {
                            photo.torrentFile = files[0];
                            Logger.debug('torrentFile (paths) using first file: ' + photo.torrentFile.name);
                        }

                    } else {
                        if(!photo.secure) {
                            let localFiles = files;
                            if(photo.isAudio) {
                                localFiles = torrent.files;
                            }
                            photo.torrentFileThumb = localFiles.find(file => file.name === 'Thumbnail ' + photo.fileName);
                            photo.torrentFile = files.find(file => file.name === photo.fileName);
                            
                            // Fallback: if no exact match, try to find the main file (non-thumbnail)
                            if (!photo.torrentFile) {
                                photo.torrentFile = files.find(file => !file.name.startsWith('Thumbnail '));
                                if (photo.torrentFile) {
                                    Logger.debug('torrentFile fallback to: ' + photo.torrentFile.name);
                                }
                            }
                        } else {
                            photo.torrentFile = files.find(file => file.name === torrent.name);
                        }
                        
                        // Final fallback: use the first file if still not found
                        if (!photo.torrentFile && files.length > 0) {
                            photo.torrentFile = files[0];
                            Logger.debug('torrentFile using first file: ' + photo.torrentFile.name);
                        }
                    }
                    photo.fromCache = fromCache;
                    // A photo already served from the blob cache stays on
                    // screen while its torrent is re-added after a reload.
                    photo.loading = !photo.img;
                    photo.rendering = false;
                    photo.torrent = torrent;
                    photo.url = torrent.magnetURI;
                    this.emitter.emit('thumbsReady', photo.torrentFileThumb);
                    return photo;
                });

                this.defineStrategy(torrent.files, torrent);
                this.storeTorrent(torrent).then(torrent => {
                    this.addTorrent(torrent, photos, fromCache, paths);
                    this.master.service.addOwner(photos.map(photo => {
                        return {
                            infoHash: photo.infoHash,
                            peerId: this.master.client.peerId,
                            loading: true
                        }
                    })).then(() => {
                        Logger.info('added owner ' + torrent.name);
                    });
                    resolve(torrent);
                });
            });

            torrent.on('infoHash', () => {
                resolve(torrent);
            });

            torrent.on('error', err => {
                Logger.error('torrent.add '+err);
                reject(err);
            });

            torrent.on('done', () => {
                self.done(torrent);
                //resolve(torrent);
            });
        });
    }

    addTorrent(torrent, photos) {

        this.emitter.emit('torrentReady', photos);
    }

    /**
     * Start seeding local files and publish upload tiles before generating previews.
     * `files` accepts a File or iterable of Files. For secure uploads, supply
     * encrypted Files and matching original Files in `origFiles` for display metadata.
     * Thumbnail failures fall back to sharing without previews. Validation and
     * seeding failures are reported through the callback or photo/error events;
     * errors preparing file metadata before seeding reject the returned promise.
     * The callback receives a ready torrent or `(null, error)` for reported failures.
     * The promise resolves to the started torrent, or null/undefined on handled
     * failure, without waiting for room sharing, storage, or server-copy uploads.
     */
    async seed(files, secure = false, origFiles = [], callback) {

        const self = this;

        // Ensure files is an array (handle FileList and other iterables)
        let filesArr;
        if(!files) {
            const error = new Error('No files provided to seed');
            Logger.error(error.message);
            if(callback) {
                callback(null, error);
            }
            return null;
        } else if(Array.isArray(files)) {
            filesArr = [...files];
        } else if(files instanceof File || files instanceof Blob) {
            filesArr = [files];
        } else if(typeof files[Symbol.iterator] === 'function') {
            // Handle FileList and other iterables
            try {
                filesArr = Array.from(files);
            } catch(e) {
                const error = new Error('Failed to convert files to array: ' + e.message);
                Logger.error(error.message);
                if(callback) {
                    callback(null, error);
                }
                return null;
            }
        } else {
            const error = new Error('Invalid files input: must be File, Blob, array, or iterable');
            Logger.error(error.message);
            if(callback) {
                callback(null, error);
            }
            return null;
        }
        
        // Ensure origFiles is an array
        let origFilesArr;
        if(Array.isArray(origFiles)) {
            origFilesArr = [...origFiles];
        } else if(origFiles instanceof File || origFiles instanceof Blob) {
            origFilesArr = [origFiles];
        } else if(origFiles && typeof origFiles[Symbol.iterator] === 'function') {
            try {
                origFilesArr = Array.from(origFiles);
            } catch(e) {
                Logger.warn('Failed to convert origFiles to array: ' + e.message);
                origFilesArr = [];
            }
        } else {
            origFilesArr = [];
        }
        
        // Show the upload right away: generating thumbnails decodes every
        // photo first, which takes seconds on a phone.
        if(!filesArr.some(item => item instanceof File)) {
            const error = new Error('No valid files to seed');
            Logger.error(error.message);
            if(callback) {
                callback(null, error);
            }
            return;
        }

        const formatToken = 'H:m MMM d y';
        const photos = filesArr.map((file, index) => {
            const origFile = secure ? origFilesArr[index] : file;
            return {
                infoHash: shortid.generate(),
                isFake: true,
                seed: true, rendering: true,
                peerId: this.master.client.peerId, owners: [],
                file: origFile, origFile: secure ? file : file, secure: secure,
                picDateTaken: secure ? format(origFile.lastModified, formatToken) : format(file.lastModified, formatToken),
                fileType: origFile.type, fileName: origFile.name, thumbnailFiles: []
            };
        });

        this.master.emitter.emit('photos', {type: 'add', item: photos});

        // Fingerprints let others see they already have a photo. Encrypted
        // shares get none, so the room learns nothing about their contents.
        const fingerprinting = secure
            ? Promise.resolve([])
            : Promise.all(filesArr.map(file => fingerprintFile(file)));

        let thumbnailFiles = [];

        if(!secure) {

            try {
                // Photos, album art and a frame of each clip, all grabbed here.
                thumbnailFiles = await extractThumbnails(filesArr);
            } catch(err) {
                // The tile is already showing; share without a preview.
                Logger.warn('thumbnail generation failed: ' + (err.message || err));
                thumbnailFiles = [];
            }

            if(thumbnailFiles.length > 0) {
                Logger.info('thumbnailFile sizes ' + thumbnailFiles.map(item => FileUtil.formatBytes(item.size)));
                // Combine thumbnails and original files, ensuring we only include valid File objects
                const combinedFiles = [];
                for(let i = 0; i < Math.max(thumbnailFiles.length, filesArr.length); i++) {
                    if(thumbnailFiles[i] && thumbnailFiles[i] instanceof File) {
                        combinedFiles.push(thumbnailFiles[i]);
                    }
                    if(filesArr[i] && filesArr[i] instanceof File) {
                        combinedFiles.push(filesArr[i]);
                    }
                }
                files = combinedFiles.filter(item => item instanceof File);
            } else {
                Logger.warn('Cannot find thumbnail');
                // Ensure files array only contains valid File objects
                files = filesArr.filter(item => item instanceof File);
            }
        } else {
            // Encrypted shares carry no preview, ensure we only pass valid File objects
            files = filesArr.filter(item => item instanceof File);
        }

        if(thumbnailFiles.length > 0) {
            photos.forEach(photo => {
                photo.thumbnailFiles = thumbnailFiles;
            });
            self.emitter.emit('photos', {type: 'update', item: photos});
        }

        const fingerprints = await fingerprinting;
        photos.forEach((photo, index) => {
            if(fingerprints[index]) {
                photo.fingerprint = fingerprints[index];
            }
        });
        rememberHave(fingerprints, 'shared');

        // Final validation: ensure all files are valid File objects
        if(!files || files.length === 0) {
            const error = new Error('No valid files to seed');
            Logger.error(error.message);
            photos.forEach(photo => {
                photo.uploadError = error.message;
                photo.rendering = false;
                photo.loading = false;
            });
            self.emitter.emit('photos', {type: 'update', item: photos});
            if(callback) {
                callback(null, error);
            }
            return;
        }

        Logger.info('seed ' + files.map(item => item.name).join(', '));

        /*const thumbnails = await Promise.all(filesArr.map(item => exifr.thumbnail(item)));
        const thumbnailBlobs = thumbnails.map((item, index) => new Blob(item, {
            type: filesArr[index].type
        }));
        const allFiles = [...thumbnailBlobs, ...filesArr];*/

        let torrent;
        try {
            // Validate files before attempting to seed
            if(!files || files.length === 0) {
                const error = new Error('No valid files to seed');
                Logger.error(error.message);
                photos.forEach(photo => {
                    photo.uploadError = error.message;
                    photo.rendering = false;
                    photo.loading = false;
                });
                self.emitter.emit('photos', {type: 'update', item: photos});
                self.emitter.emit('showError', 'Upload Failed: ' + error.message);
                if(callback) {
                    callback(null, error);
                }
                return;
            }
            
            /** Publish seeded photos and track room confirmation, waiting for metadata if needed. */
            const processTorrentReady = (torrent) => {
                if(!torrent || !torrent.infoHash) {
                    Logger.error('processTorrentReady called with invalid torrent');
                    photos.forEach(photo => {
                        photo.uploadError = 'Torrent failed to initialize';
                        photo.rendering = false;
                        photo.loading = false;
                    });
                    self.emitter.emit('photos', {type: 'update', item: photos});
                    self.emitter.emit('showError', 'Failed to upload image: Torrent failed to initialize');
                    return;
                }

                Logger.info('seed.done ' + torrent.infoHash);

                // Ensure torrent.files is available
                if(!torrent.files || torrent.files.length === 0) {
                    Logger.warn('Torrent has no files, waiting for metadata event');
                    torrent.once('metadata', () => {
                        processTorrentReady(torrent);
                    });
                    return;
                }

                //this.storeTorrent(torrent);

                const withoutThumbs = torrent.files.filter(item => !item.name.startsWith('Thumbnail '));
                const addedInfoHash = photos.map(photo => {
                    photo.infoHash = torrent.infoHash;
                    if(withoutThumbs.length > 1) {
                        const matchingFile = withoutThumbs.find(file => file.name === photo.file.name);
                        if(matchingFile) {
                            photo.infoHash += '-' + matchingFile.path;
                        }
                    }
                    photo.url = torrent.magnetURI;
                    return photo;
                });

                const toBeShared = this.stripClientOnlyPhotoFields(addedInfoHash);
                // What the torrent carries (`origFile` is the seeded file:
                // the ciphertext of an encrypted share), for a server copy.
                const seeded = photos.map((photo, index) => ({
                    infoHash: toBeShared[index].infoHash,
                    blob: photo.origFile || photo.file
                }));

                Logger.info('seed.infoHash photo sharing');
                this.service.share(toBeShared).then(result => {
                    Logger.info('photo shared ' + result);
                    const sharedAt = Date.now();
                    this.pendingSeeds.delete(torrent);
                    this.shareStates.set(torrent.infoHash, sharedAt);
                    photos.forEach(photo => {
                        photo.sharedAt = sharedAt;
                    });
                    self.emitter.emit('photos', {type: 'update', item: photos});
                    // A server copy is left only when someone needs one (or
                    // the room keeps copies): ServerPinning decides.
                    this.master.serverPinning?.shared(seeded);
                }).catch(err => {
                    Logger.error('Failed to share photo: ' + err);
                    self.emitter.emit('showError', 'Failed to share photo: ' + (err.message || err));
                });

                this.storeTorrent(torrent).then(torrent => {
                    if(photos[0].deleted) {
                        return;
                    }
                    photos.forEach(photo => {
                        photo.isFake = photo.loading = false;
                        // Don't clear rendering here - it should be cleared when photoRendered event is emitted
                        // photo.rendering = false;
                        photo.torrent = torrent;
                        photo.infoHash = torrent.infoHash;
                        photo.url = torrent.magnetURI;
                    });
                    withoutThumbs.forEach((file, index) => {
                        const photo = photos[index];
                        photo.torrentFile = file;
                        photo.torrentFileThumb = torrent.files.find(file => file.name === 'Thumbnail ' + photo.fileName);
                        if(withoutThumbs.length > 1) {
                            photo.infoHash += '-' + file.path;
                        }
                        //self.emitter.emit('torrentReady', photo);
                    });

                    // Cache each image blob so it survives a page reload without
                    // needing tracker/peer connectivity on resurrection.
                    withoutThumbs.forEach((file, index) => {
                        const photo = photos[index];
                        if (photo.file && photo.infoHash && shouldCacheBlob(photo.fileType || photo.file.type)) {
                            cachePut(photo.infoHash, photo.file, photo.fileType || photo.file.type).catch(err => {
                                Logger.warn('Failed to cache image blob for ' + photo.infoHash + ': ' + err);
                            });
                        }
                    });

                    // Emit update to refresh UI with new state
                    self.emitter.emit('photos', {type: 'update', item: photos});
                    //withoutThumbs.forEach((file, index) => self.emitter.emit('torrentReady', photos[index]));
                    self.emitter.emit('torrentReady', photos);
                }).catch(err => {
                    Logger.error('Failed to store torrent: ' + err);
                    self.emitter.emit('showError', 'Failed to store torrent: ' + (err.message || err));
                });

                if(callback) {
                    callback(torrent);
                }
            };

            torrent = this.master.addSeedOrGetTorrent('seed', files, (torrent, err) => {
                // Handle error case (WebTorrent callback can receive error as second parameter)
                if(err) {
                    Logger.error('addSeedOrGetTorrent callback received error: ' + (err.message || err));
                    photos.forEach(photo => {
                        photo.uploadError = err.message || 'Failed to create torrent';
                        photo.rendering = false;
                        photo.loading = false;
                    });
                    self.emitter.emit('photos', {type: 'update', item: photos});
                    self.emitter.emit('showError', 'Failed to upload image: ' + (err.message || err));
                    if(callback) {
                        callback(null, err);
                    }
                    return;
                }
                
                if(!torrent) {
                    Logger.error('addSeedOrGetTorrent callback received null torrent');
                    return;
                }

                // Wait for torrent to be ready before accessing its properties
                if(!torrent.infoHash) {
                    Logger.warn('Torrent callback called but infoHash not yet available, waiting for ready event');
                    const readyHandler = () => {
                        processTorrentReady(torrent);
                    };
                    const errorHandler = (err) => {
                        Logger.error('Torrent failed while waiting for ready: ' + (err.message || err));
                        photos.forEach(photo => {
                            photo.uploadError = err.message || 'Torrent failed to initialize';
                            photo.rendering = false;
                            photo.loading = false;
                        });
                        self.emitter.emit('photos', {type: 'update', item: photos});
                        self.emitter.emit('showError', 'Failed to upload image: ' + (err.message || err));
                    };
                    torrent.once('ready', readyHandler);
                    torrent.once('error', errorHandler);
                    return;
                }

                processTorrentReady(torrent);
            });
            if(torrent) {
                this.pendingSeeds.add(torrent);
            }

            // Only attach event listeners if torrent was successfully created
            if(!torrent) {
                Logger.error('addSeedOrGetTorrent returned null torrent, cannot attach event listeners');
                // Mark photos as failed
                photos.forEach(photo => {
                    photo.uploadError = 'Failed to create torrent: Invalid input';
                    photo.rendering = false;
                    photo.loading = false;
                });
                self.emitter.emit('photos', {type: 'update', item: photos});
                self.emitter.emit('showError', 'Failed to upload image: Invalid torrent input');
                if(callback) {
                    callback(null, new Error('Failed to create torrent: Invalid input'));
                }
                return null;
            }

            torrent.on('infoHash', async () => {
                Logger.info('seed.infoHash');
            });

            torrent.on('metadata', async () => {
                Logger.info('seed.metadata');
            });

            torrent.on('error', err => {
                const errorMsg = err.message || String(err);
                
                // Check if this is a tracker/WebSocket connection error (non-fatal)
                const isConnectionError = errorMsg.includes('WebSocket') || 
                                         errorMsg.includes('connection') ||
                                         errorMsg.includes('tracker') ||
                                         errorMsg.includes('Invalid torrent identifier');
                
                if(isConnectionError && torrent && torrent.infoHash) {
                    // Tracker connection failed, but torrent is still valid
                    // Log as debug since this is expected in some browser environments
                    Logger.debug('Non-fatal torrent error (torrent still valid): ' + errorMsg);
                    // Don't mark photos as failed for connection errors if torrent has infoHash
                    return;
                }
                
                // Only log actual errors at error level
                Logger.error('Torrent error: ' + errorMsg);
                
                // For other errors, mark photos as failed
                photos.forEach(photo => {
                    photo.uploadError = errorMsg;
                    photo.rendering = false;
                    photo.loading = false;
                });
                self.emitter.emit('photos', {type: 'update', item: photos});
                self.emitter.emit('showError', 'Failed to upload image: ' + errorMsg);
            });

            this.emitter.on('torrentError', err => {

                console.error('torrent ' + err.message);

                if(!this.isDuplicateError(err)) {
                    // Not a duplicate error, show it to the user
                    photos.forEach(photo => {
                        photo.uploadError = err.message;
                        photo.rendering = false;
                        photo.loading = false;
                    });
                    self.emitter.emit('photos', {type: 'update', item: photos});
                    self.emitter.emit('showError', 'Upload error: ' + err.message);
                    return;
                }

                const torrentId = extractDuplicateTorrentId(err);
                const torrent = getTorrent(self.master.client, torrentId);
                if(torrent) {
                    self.emitter.emit('duplicate', {
                        torrent: torrent,
                        torrentId: torrentId,
                        photos: photos,
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
        } catch(err) {
            Logger.error('Failed to create torrent: ' + err);
            // Mark photos as failed
            photos.forEach(photo => {
                photo.uploadError = err.message || 'Failed to create torrent';
                photo.rendering = false;
                photo.loading = false;
            });
            self.emitter.emit('photos', {type: 'update', item: photos});
            self.emitter.emit('showError', 'Failed to upload image: ' + (err.message || err));
            return null;
        }

        return torrent;
    }

    /** Return shallow photo copies with local media, render state, and snapshot bookkeeping removed. */
    stripClientOnlyPhotoFields(photos) {
        const toBeShared = photos.map(photo => {
            const serverPhoto = {...photo};
            delete serverPhoto.isFake;
            delete serverPhoto.file;
            delete serverPhoto.origFile;
            delete serverPhoto.rendering;
            delete serverPhoto.loading;
            delete serverPhoto.seed;
            delete serverPhoto.isDecrypted;
            delete serverPhoto.torrent;
            delete serverPhoto.torrentFile;
            delete serverPhoto.torrentFileThumb;
            delete serverPhoto.thumbnailFiles;
            delete serverPhoto.picDateTakenDate;
            delete serverPhoto.picSummary;
            delete serverPhoto.metadata;
            delete serverPhoto.hasMetadata;
            delete serverPhoto.elem;
            delete serverPhoto.img;
            delete serverPhoto.previewUrl;
            delete serverPhoto.sharedAt;
            delete serverPhoto.tileKey;
            return serverPhoto;
        });
        return toBeShared;
    }

    defineStrategy(files, opts) {
        if(files.filter(item => !item.isThumbnail).every(file => {
            const ext = file.name.split('.').pop().toLowerCase();
            return !this.master.STREAMING_FORMATS.includes(ext);
        })) {
            opts.strategy = this.master.strategyPreference ? 'sequential' : 'rarest';
            //opts.strategy = 'rarest';
        }
    }

    isDuplicateError(err) {
        return isDuplicateTorrentError(err);
    }

    metadata(torrent) {

        Logger.info('metadata '+ torrent.infoHash);
        this.master.peers.connect(torrent, this.master.client.peerId);
    }

    async storeTorrent(torrent) {
        //Once generated, stores the metadata for later use when re-adding the torrent!
        // WebTorrent 3 hands over the torrent file as a Uint8Array, which the
        // old browserified parsetorrent.js rejects; nothing was ever stored,
        // so after a refresh a clip (not in the image cache) had no way back.
        let parsed;
        try {
            parsed = await parseTorrent(torrent.torrentFile);
        } catch (e) {
            Logger.warn('storeTorrent cannot parse ' + torrent.infoHash + ': ' + (e.message || e));
            return torrent; // Don't fail the whole flow
        }
        
        const key = parsed.infoHash;

        return new Promise((resolve, reject) => {

            const self = this;
            this.torrentsDb.get(key, (err, value) => {
                if (err) {
                    Logger.debug('storeTorrent torrentsDb.get error: ' + err);
                    resolve(torrent); // Resolve anyway so the flow continues
                    return;
                }

                if(!value) {
                    try {
                        self.torrentsDb.add(key, parsed, () => {
                            Logger.debug('storeTorrent IndexedDB added ' + key);
                            resolve(torrent);
                        });
                    } catch(e) {
                        Logger.warn('storeTorrent IndexedDB error saving ' + e.message);
                        resolve(torrent);
                    }

                } else {
                    Logger.debug('storeTorrent metadata already added ' + key);
                    resolve(torrent);
                }
            });
        });

    }

    wire(wire, addr, torrent) {
        this.emitter.emit('wire', wire, addr, torrent);
        const remotePeerId = wire.peerId.toString();
        const myPeerId = this.master.client.peerId;
        
        // For WebRTC connections, wire.remoteAddress is undefined
        // Report connection with just peerIds - server will infer connection type from networkChains
        const remoteAddr = wire.remoteAddress || (addr ? addr.split(':')[0] : null);
        const remotePort = wire.remotePort || (addr ? parseInt(addr.split(':')[1]) : null);
        
        // Report connection for TopologyView - server uses peerIds to look up network info
        this.master.peers.connectWire(myPeerId, torrent, remotePeerId, remoteAddr, remotePort);

        if(remotePeerId && remoteAddr) {
            const peer = this.master.peers.items.find(item => item.peerId == remotePeerId);
            if(peer) {
                const network = peer.networkChain ? peer.networkChain.find(item => item.ip === remoteAddr) : null;
                if(network) {
                    Logger.info('wire peer ' + StringUtil.createNetworkLabel(network) + ' ' + addr);
                    return;
                }
            }
            Logger.info('wire ' + addr);
        }
    }

    infoHash(t, infoHash) {
        //Logger.info('infoHash '+infoHash);
    }

    noPeers(t, announceType) {
        Logger.warn('noPeers ' + announceType);
    }

    warning(t, err) {
        Logger.warn('warning '+err);
    }

    trackerAnnounce(...rest) {
        //Logger.info('trackerAnnounce ' + rest);
    }

    peer(peer, source) {
        //Logger.info('Webtorrent peer ' + peer.id + ' ' + source);
    }

    async done(torrent) {
        Logger.info('done ' + torrent.name);

        // Receivers cache what they downloaded too (previously only the
        // uploader did), so a receiver's reload / later re-share does not
        // depend on finding a peer again.
        if (torrent.files) {
            const files = torrent.files.filter(file => !file.name.startsWith('Thumbnail '));
            files.forEach(file => {
                // WebTorrent 3 replaced getBlob(cb) with blob(); with only the old
                // call, receivers never cached anything and every reload showed
                // their photos loading again.
                if (file.type && !shouldCacheBlob(file.type)) return;
                readFileBlob(file).then(blob => {
                    if (!blob || !shouldCacheBlob(blob.type)) return;
                    const key = files.length > 1
                        ? torrent.infoHash + '-' + file.path
                        : torrent.infoHash;
                    return cachePut(key, blob, blob.type);
                }).catch(() => {});
            });
        }

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