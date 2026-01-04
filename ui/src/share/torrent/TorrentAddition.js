import Logger from 'js-logger';
import shortid  from 'shortid';
import StringUtil from "../util/StringUtil";
import {format} from 'date-fns';
//import * as exifr from 'exifr';
import exifr from 'exifr/dist/full.esm.mjs'
import _ from 'lodash';
import FileUtil from "../util/FileUtil";
import * as musicMetadata from 'music-metadata-browser';
import React from "react";

export default class TorrentAddition {

    constructor(service, torrentsDb, emitter, master) {
        this.service = service;
        this.torrentsDb = torrentsDb;
        this.emitter = emitter;
        this.master = master;

        emitter.on('photoRendered', this.updatePhotoThatRendered, this);
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
            const infoHashes = serverPhotos.map(photo => {
                return photo.infoHash.split('-');
            });

            const torrentId = infoHashes[0][0];
            let torrent = this.master.client.get(torrentId);
            
            // WebTorrent bug: client.get() returns empty object {} instead of null
            if (torrent && !torrent.infoHash) {
                torrent = null;
            }
            
            if(!torrent) {
                this._add(torrentId, serverPhotos, false, infoHashes.map(item => item[1]))
            }
        } else if(serverPhotos.length === 1) {
            const photo = serverPhotos[0];
            this.add(photo.infoHash, photo);
        }
    }

    add(torrentId, photo, fromCache) {
        // Extract base infoHash (without file path suffix)
        const baseInfoHash = photo.infoHash ? photo.infoHash.split('-')[0] : null;
        let torrent = baseInfoHash ? this.master.client.get(baseInfoHash) : null;
        
        // WebTorrent bug: client.get() returns empty object {} instead of null for non-existent torrents
        if (torrent && !torrent.infoHash) {
            torrent = null;
        }
        
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
                    photo.loading = true;
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

    async getPreviewFromImage(filesArr) {
        let thumbnailUrls = [];
        try {
            const tUrls = filesArr.map(item => exifr.thumbnailUrl(item));
            thumbnailUrls = await Promise.all(tUrls);
        } catch(e) {
            Logger.warn('Cannot find thumbnail from EXIF ' + e + ' ' + filesArr.map(item => item.name));
        }

        thumbnailUrls = thumbnailUrls.filter(item => item);

        // Fallback: For images without EXIF thumbnails (like PNGs), create thumbnails from the image itself
        if(thumbnailUrls.length < filesArr.length) {
            Logger.info('Creating fallback thumbnails for images without EXIF data');
            const fallbackThumbnails = await Promise.all(
                filesArr.map(async (file, index) => {
                    // If we already have a thumbnail for this file, skip it
                    if(thumbnailUrls[index]) {
                        return null;
                    }
                    try {
                        // Create a thumbnail by loading the image and creating a canvas
                        return new Promise((resolve, reject) => {
                            const img = new Image();
                            const canvas = document.createElement('canvas');
                            const ctx = canvas.getContext('2d');
                            
                            img.onload = () => {
                                // Create a thumbnail (max 200x200)
                                const maxSize = 200;
                                let width = img.width;
                                let height = img.height;
                                
                                if(width > height) {
                                    if(width > maxSize) {
                                        height = (height * maxSize) / width;
                                        width = maxSize;
                                    }
                                } else {
                                    if(height > maxSize) {
                                        width = (width * maxSize) / height;
                                        height = maxSize;
                                    }
                                }
                                
                                canvas.width = width;
                                canvas.height = height;
                                ctx.drawImage(img, 0, 0, width, height);
                                
                                canvas.toBlob((blob) => {
                                    if(blob) {
                                        const url = URL.createObjectURL(blob);
                                        resolve(url);
                                    } else {
                                        reject(new Error('Failed to create thumbnail blob'));
                                    }
                                }, file.type, 0.9);
                            };
                            
                            img.onerror = () => {
                                reject(new Error('Failed to load image for thumbnail'));
                            };
                            
                            img.src = URL.createObjectURL(file);
                        });
                    } catch(e) {
                        Logger.warn('Failed to create fallback thumbnail for ' + file.name + ': ' + e);
                        return null;
                    }
                })
            );
            
            // Add fallback thumbnails to the array
            fallbackThumbnails.forEach((thumb, index) => {
                if(thumb && !thumbnailUrls[index]) {
                    thumbnailUrls[index] = thumb;
                }
            });
        }

        if(thumbnailUrls.length < 1) {
            Logger.warn('No thumbnail found for any image.');
            return [];
        }

        const thumbnailBlobs = await Promise.all(thumbnailUrls
            .filter(item => item)
            .map(item => {
                // If it's already a blob URL, fetch it; otherwise it's already a blob
                if(typeof item === 'string' && item.startsWith('blob:')) {
                    return fetch(item).then(r => r.blob());
                }
                return Promise.resolve(item);
            }));

        const thumbnailFiles = thumbnailBlobs.map((item, index) => {
            const file = filesArr[index];
            const fileName = 'Thumbnail ' + file.name;
            const thumb = new File([item], fileName, {
                type: file.type,
                lastModified: file.lastModified
            });
            return thumb;
        });
        return thumbnailFiles;
    }

    async getPreviewFromAudio(filesArr) {
        let metadatas = [];

        try {
            const results = filesArr.map(item => musicMetadata.parseBlob(item));
            metadatas = await Promise.all(results);
        } catch(e) {
            Logger.warn('Cannot find thumbnail ' + e + ' ' + filesArr.map(item => item.name));
        }

        const thumbnailBlobs = metadatas
            .filter(item => item)
            .map((item, index) => {
                const picture = item.common.picture;
                if(!picture) {
                    return;
                }
                if(picture && picture.length > 1) {
                    Logger.warn('Can only show one album art preview but found ' + picture.length);
                }
                let thumb;
                const pic = picture[0];
                if(pic) {
                    const file = filesArr[index];
                    const fileName = 'Thumbnail ' + file.name;
                    //const fileName = file.name;
                    thumb = new File([pic.data], fileName, {
                        type: pic.format,
                    });
                }
                return thumb;
            }).filter(item => item);
        return thumbnailBlobs;
    }

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
        
        let thumbnailFiles = [];

        if(!secure && filesArr
            .filter(item => item)
            .every(item => (item.type.includes('image/') || item.type.includes('audio/')))
        ) {

            if(filesArr.every(item => item.type.includes('image/'))) {
                thumbnailFiles = await this.getPreviewFromImage(filesArr);
            } else if(filesArr.every(item => item.type.includes('audio/'))) {
                thumbnailFiles = await this.getPreviewFromAudio(filesArr);
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
            // For secure files or non-image/audio, ensure we only pass valid File objects
            files = filesArr.filter(item => item instanceof File);
        }

        // Final validation: ensure all files are valid File objects
        if(!files || files.length === 0) {
            const error = new Error('No valid files to seed');
            Logger.error(error.message);
            if(callback) {
                callback(null, error);
            }
            return;
        }

        Logger.info('seed ' + files.map(item => item.name).join(', '));

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
                fileType: origFile.type, fileName: origFile.name, thumbnailFiles: thumbnailFiles
            };
        });

        this.master.emitter.emit('photos', {type: 'add', item: photos});

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
            
            // Define helper function to process torrent when ready
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

                Logger.info('seed.infoHash photo sharing');
                this.service.share(toBeShared).then(result => {
                    Logger.info('photo shared ' + result);
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

                const msg = err.message;
                const torrentId = msg.substring(msg.lastIndexOf('torrent ') + 8, msg.length);
                const torrent = self.master.client.get(torrentId);
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
        const msg = err.message;
        return msg.indexOf('Cannot add duplicate') !== -1;
    }

    metadata(torrent) {

        Logger.info('metadata '+ torrent.infoHash);
        this.master.peers.connect(torrent, this.master.client.peerId);
    }

    storeTorrent(torrent) {
        //Once generated, stores the metadata for later use when re-adding the torrent!
        let parsed;
        try {
            parsed = window.parsetorrent(torrent.torrentFile);
        } catch (e) {
            Logger.debug('storeTorrent parsetorrent error: ' + e.message);
            return Promise.resolve(torrent); // Don't fail the whole flow
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