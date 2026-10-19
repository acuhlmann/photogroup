import React, { useState, useEffect, useRef, useCallback } from 'react';
import PropTypes from 'prop-types';
import { useTheme } from '@mui/material/styles';
import Box from '@mui/material/Box';
import Typography from '@mui/material/Typography';
import CircularProgress from '@mui/material/CircularProgress';
import CloudUploadIcon from '@mui/icons-material/CloudUploadRounded';
import AddPhotoAlternateRounded from '@mui/icons-material/AddPhotoAlternateRounded';
import Logger from 'js-logger';
import FileUtil from '../util/FileUtil';
import {withSnackbar} from "../compatibility/withSnackbar";
import update from "immutability-helper";
import _ from "lodash";
import LoadingTile from "./LoadingTile";
import StringUtil from "../util/StringUtil";
import ContentTile from "./ContentTile";
import TileErrorBoundary from "./TileErrorBoundary";
import GalleryPhotoHandler from "./GalleryPhotoHandler";
import PhotoViewer from "./PhotoViewer";
import NetworkReadout from "../topology/NetworkReadout";
import { getBlobAndEmit } from "../torrent/BlobUtils";
import { cacheGet, shouldCacheBlob } from "../util/ImageBlobCache";
import { runViewTransition } from "./viewTransition";

/** Render the upload input's label, optionally limiting its width for a narrow gallery. */
function AddPhotosStrip({ narrow }) {
    return (
        <Box
            component="label"
            htmlFor="contained-button-file"
            className="drop-target"
            data-testid="add-photos-strip"
            sx={{
                minHeight: '0 !important',
                flexDirection: 'row !important',
                gap: 1,
                py: '10px !important',
                mb: 2,
                maxWidth: narrow ? 880 : 'none',
                mx: narrow ? 'auto' : 0,
            }}
        >
            <AddPhotoAlternateRounded sx={{ fontSize: 20, color: 'primary.main' }} />
            <Typography variant="body2" sx={{ color: 'text.primary', fontWeight: 600 }}>
                Add photos
            </Typography>
            <Typography variant="caption" sx={{ color: 'text.secondary' }}>
                drop here or tap
            </Typography>
        </Box>
    );
}

/**
 * Display room tiles, accept dropped uploads, and open the media viewer.
 * An unsynced empty gallery waits for a snapshot or four seconds before showing the upload prompt.
 * `showNetworkReadout` controls the readout in the empty state and defaults to true.
 */
function Gallery(props) {
    const {master, showNetworkReadout = true} = props;
    const theme = useTheme();
    const [tiles, setTiles] = useState([]);
    const [dragOver, setDragOver] = useState(false);
    const [selectedIndex, setSelectedIndex] = useState(null);
    // Until the first room snapshot arrives, an empty gallery means "not
    // loaded yet", not "no photos": after a reload it looked like they were gone.
    const [roomSynced, setRoomSynced] = useState(() => !!master.roomSynced);
    const [roomSyncTimedOut, setRoomSyncTimedOut] = useState(false);
    const photoHandlerRef = useRef(null);
    const dragCounterRef = useRef(0);

    const handleDragEnter = useCallback((e) => {
        e.preventDefault();
        e.stopPropagation();
        dragCounterRef.current += 1;
        if (e.dataTransfer.items && e.dataTransfer.items.length > 0) {
            setDragOver(true);
        }
    }, []);

    const handleDragLeave = useCallback((e) => {
        e.preventDefault();
        e.stopPropagation();
        dragCounterRef.current -= 1;
        if (dragCounterRef.current === 0) {
            setDragOver(false);
        }
    }, []);

    const handleDragOver = useCallback((e) => {
        e.preventDefault();
        e.stopPropagation();
    }, []);

    const handleDrop = useCallback((e) => {
        e.preventDefault();
        e.stopPropagation();
        setDragOver(false);
        dragCounterRef.current = 0;
        const files = e.dataTransfer && e.dataTransfer.files;
        if (files && files.length > 0 && master.torrentAddition) {
            master.torrentAddition.seed(files);
        }
    }, [master]);

    const getBlob = useCallback((photo) => {
        // Use the simplified BlobUtils module for blob retrieval
        getBlobAndEmit(photo, master.emitter).catch(err => {
            Logger.error('getBlob error for ' + (photo.fileName || 'unknown') + ': ' + err.message);
        });
    }, [master.emitter]);

    const mergeStreamingMetadata = useCallback((photo, extention) => {
        photo.loading = false;
        photo.elem = null;
        photo.img = null;
        photo.fileSize = photo.fileSize || FileUtil.formatBytes(photo.torrentFile.length);
        photo.isVideo = master.STREAMING_VIDEO_FORMATS.includes(extention);
        photo.isAudio = master.STREAMING_AUDIO_FORMATS.includes(extention);
        photo.isImage = false;
        return photo;
    }, [master]);

    const mergePreloadMetadata = useCallback((photo) => {
        //photo.fileName = FileUtil.truncateFileName(photo.torrentFile.name);
        //photo.picSummary = photo.picSummary || (StringUtil.addEmptySpaces([photo.picDateTaken, photo.fileName]));
    }, []);

    const mergePostloadMetadata = useCallback((photo, file, noElem) => {
        photo.loading = false;
        const isImage = photo.fileType.includes('image/');
        photo.elem = (noElem && !isImage) ? null : file;
        // A photo restored from cache already shows this file; a new URL would
        // make the tile reload its image.
        photo.img = isImage ? (photo.img || URL.createObjectURL(file)) : null;
        photo.fileSize = photo.fileSize || FileUtil.formatBytes(noElem ? photo.torrentFile.length : (photo.elem ? photo.elem.size : file.size));
        photo.isVideo = photo.fileType.includes('video/');
        photo.isImage = isImage;
        photo.isAudio = photo.fileType.includes('audio/');
        return photo;
    }, []);

    const renderTile = useCallback((photos, isSeeding, updateOwner) => {
        setTiles(state => {
            const oldTiles = state;
            let newTiles = oldTiles;
            photos.forEach(photo => {
                const index = oldTiles.findIndex(item => item.infoHash === photo.infoHash);
                if(index > -1) {
                    photo = _.merge(oldTiles[index], photo);
                    update(oldTiles, {$splice: [[index, 1, photo]]});
                } else {
                    newTiles = update(oldTiles, {$unshift: [photo]});
                }
            });

            if(!isSeeding && updateOwner) {
                newTiles.forEach(photo => {
                    master.service.updateOwner([{
                        infoHash: photo.infoHash,
                        peerId: master.client.peerId,
                        loading: false
                    }]).then(() => {
                        //Logger.info('owner registered ' + photo.torrent.name)
                    })
                });
            }

            return newTiles;
        });
    }, [master]);

    const addMediaToDom = useCallback((photos) => {
        const isSeeding = photos[0].seed;
        if(isSeeding) {
            photos.forEach(photo => {
                mergePreloadMetadata(photo);
                mergePostloadMetadata(photo, photo.file, true);
                // For images, ensure elem and img are set so rendering can proceed
                if(photo.isImage && photo.elem && !photo.img) {
                    photo.img = URL.createObjectURL(photo.elem);
                }
                // For seeded images, immediately emit blobDone to trigger metadata reading
                // This ensures readMetadata is called and photoRendered is emitted
                if(photo.isImage && photo.elem) {
                    Logger.info('Seeded image ready, emitting blobDone for ' + photo.fileName);
                    master.emitter.emit('blobDone-' + photo.infoHash, photo);
                }
                // Full blobs are only needed for images (metadata + cache). Streaming
                // video/audio must not be read entirely into memory here.
                if (photo.isImage) {
                    getBlob(photo);
                } else if ((photo.isVideo || photo.isAudio) && photo.file && master.metadata) {
                    master.metadata.readMetadata(photo, (updatedTile) => {
                        master.emitter.emit('photos', { type: 'update', item: [updatedTile] });
                    });
                }
            });
            renderTile(photos, isSeeding);
        } else {
            const photoPromises = photos.map(photo => {
                return new Promise(async (resolve, reject) => {
                    // Cache-first: if this photo was resurrected from a previous session,
                    // try to serve the blob directly from IndexedDB without touching the
                    // WebTorrent peer/tracker layer (which can hang when offline or after
                    // the browser returns from standby).
                    if (photo.fromCache && photo.infoHash && shouldCacheBlob(photo.fileType)) {
                        try {
                            const cachedBlob = await cacheGet(photo.infoHash);
                            if (cachedBlob) {
                                Logger.info('addMediaToDom: serving from blob cache for ' + (photo.fileName || photo.infoHash));
                                const file = new File([cachedBlob], photo.fileName || 'image', { type: photo.fileType || cachedBlob.type });
                                resolve(mergePostloadMetadata(photo, file));
                                return;
                            }
                        } catch (cacheErr) {
                            Logger.warn('addMediaToDom: blob cache lookup failed, falling through: ' + cacheErr);
                        }
                    }

                    // Check if torrentFile exists and has required methods
                    if (!photo.torrentFile) {
                        Logger.warn('addMediaToDom: torrentFile is null/undefined for ' + (photo.fileName || 'unknown'));
                        reject('torrentFile not available');
                        return;
                    }

                    const hasGetBlob = typeof photo.torrentFile.getBlob === 'function';
                    const hasGetBlobURL = typeof photo.torrentFile.getBlobURL === 'function';
                    Logger.info('addMediaToDom: ' + photo.fileName + ' hasGetBlob=' + hasGetBlob + ' hasGetBlobURL=' + hasGetBlobURL);

                    if (!hasGetBlob && !hasGetBlobURL) {
                        Logger.warn('addMediaToDom: No blob methods available for ' + (photo.fileName || 'unknown'));

                        // Workaround: manually create blob using createReadStream if available
                        if (typeof photo.torrentFile.createReadStream === 'function') {
                            Logger.info('addMediaToDom: Using createReadStream workaround for ' + photo.fileName);
                            try {
                                const stream = photo.torrentFile.createReadStream();
                                const chunks = [];
                                stream.on('data', chunk => chunks.push(chunk));
                                stream.on('end', () => {
                                    const blob = new Blob(chunks, { type: photo.fileType || 'application/octet-stream' });
                                    const file = new File([blob], photo.fileName, { type: photo.fileType });
                                    resolve(mergePostloadMetadata(photo, file));
                                });
                                stream.on('error', err => {
                                    Logger.error('createReadStream error: ' + err.message);
                                    reject(err.message);
                                });
                            } catch (streamErr) {
                                Logger.error('createReadStream exception: ' + streamErr.message);
                                // Fall through to streaming metadata
                                if (photo.torrentFile.name) {
                                    const ext = photo.torrentFile.name.split('.').pop().toLowerCase();
                                    resolve(mergeStreamingMetadata(photo, ext));
                                } else {
                                    reject('torrentFile methods not available');
                                }
                            }
                        } else if (photo.torrentFile.name) {
                            Logger.warn('addMediaToDom: No stream methods either, using streaming metadata');
                            const ext = photo.torrentFile.name.split('.').pop().toLowerCase();
                            resolve(mergeStreamingMetadata(photo, ext));
                        } else {
                            reject('torrentFile methods not available');
                        }
                        return;
                    }

                    // Use getBlobURL if getBlob isn't available
                    if (!hasGetBlob && hasGetBlobURL) {
                        Logger.info('addMediaToDom: Using getBlobURL for ' + photo.fileName);
                        photo.torrentFile.getBlobURL((err, url) => {
                            if (err) {
                                Logger.error('getBlobURL error: ' + err.message);
                                reject(err.message);
                            } else {
                                fetch(url)
                                    .then(response => response.blob())
                                    .then(blob => {
                                        const file = new File([blob], photo.fileName, { type: photo.fileType });
                                        resolve(mergePostloadMetadata(photo, file));
                                    })
                                    .catch(fetchErr => {
                                        Logger.error('fetch blob error: ' + fetchErr.message);
                                        reject(fetchErr.message);
                                    });
                            }
                        });
                        return;
                    }

                    const extention = photo.torrentFile.name.split('.').pop().toLowerCase();
                    const isNoStreamingOrTooLarge = !master.STREAMING_FORMATS.includes(extention)
                        || FileUtil.largerThanMaxBlobSize(photo.torrentFile.length);
                    if(isNoStreamingOrTooLarge || photo.secure) {
                        Logger.info('getBlob ' + photo.torrent.name);
                        mergePreloadMetadata(photo);
                        photo.torrentFile.getBlob((err, elem) => {
                            Logger.info('getBlob done ' + photo.torrent.name);
                            if (err) {
                                Logger.error(err.message);
                                reject(err.message);
                            } else {
                                const file = new File([elem], photo.fileName, { type: photo.fileType });
                                resolve(mergePostloadMetadata(photo, file));
                            }
                        });
                    } else {
                        resolve(mergeStreamingMetadata(photo, extention));
                    }
                });
            });

            renderTile(photos, false, false);

            Promise.allSettled(photoPromises).then(results => {
                const fulfilled = results
                    .filter(r => r.status === 'fulfilled')
                    .map(r => r.value);
                if (fulfilled.length > 0) {
                    renderTile(fulfilled, false, true);
                }
            });
        }
    }, [master, getBlob, mergePreloadMetadata, mergePostloadMetadata, renderTile, mergeStreamingMetadata]);

    const updateGalleryState = useCallback(() => {
        const hasImages = tiles && tiles.find(tile => !tile.isLoading && tile.img);
        if(hasImages) {
            master.emitter.emit('galleryHasImages', true);
        } else {
            master.emitter.emit('galleryHasImages', false);
        }
    }, [tiles, master.emitter]);

    useEffect(() => {
        const emitter = master.emitter;

        const handleTorrentReady = (photos) => {
            addMediaToDom(photos);
        };

        const handleDuplicate = (duplicated) => {
            setTiles(state => {
                let newTiles = state;
                duplicated.photos.forEach(photo => {
                    const index = newTiles.findIndex(item => item.infoHash === photo.infoHash);
                    if(index > -1) {
                        newTiles = update(newTiles, {$splice: [[index, 1]]});
                    }
                });
                return newTiles;
            });
        };

        emitter.on('torrentReady', handleTorrentReady);
        emitter.on('duplicate', handleDuplicate);

        photoHandlerRef.current = new GalleryPhotoHandler({ addMediaToDom, setTiles, master }, emitter);
        // This effect re-runs on every tile change; without unsubscribing,
        // each photo event was handled once per past render.
        const stopPhotoSync = photoHandlerRef.current.sync();

        // Emit initial gallery state
        updateGalleryState();

        return () => {
            emitter.removeListener('torrentReady', handleTorrentReady);
            emitter.removeListener('duplicate', handleDuplicate);
            stopPhotoSync();
        };
    }, [master, updateGalleryState, addMediaToDom]);

    useEffect(() => {
        updateGalleryState();
    }, [tiles, updateGalleryState]);

    useEffect(() => {
        const emitter = master.emitter;
        /** Mark the room synced only after a complete photo snapshot arrives. */
        const handlePhotos = event => {
            if (event?.type === 'all' && Array.isArray(event.item)) {
                clearTimeout(fallback);
                setRoomSyncTimedOut(false);
                setRoomSynced(true);
            }
        };
        // Only a room snapshot can say the room is empty; if it is slow (or
        // the join failed), keep saying so but let people add photos anyway.
        const fallback = setTimeout(() => setRoomSyncTimedOut(true), 4000);
        emitter.on('photos', handlePhotos);
        return () => {
            clearTimeout(fallback);
            emitter.removeListener('photos', handlePhotos);
        };
    }, [master.emitter]);

    const openAt = useCallback((index) => {
        runViewTransition(() => setSelectedIndex(index));
    }, []);

    const showIndex = useCallback((index) => {
        setSelectedIndex(index);
    }, []);

    const closeViewer = useCallback(() => {
        runViewTransition(() => setSelectedIndex(null));
    }, []);

    useEffect(() => {
        if (selectedIndex != null && selectedIndex >= tiles.length) {
            setSelectedIndex(tiles.length ? tiles.length - 1 : null);
        }
    }, [tiles.length, selectedIndex]);

    const buildTile = useCallback((tile, index, master) => {
        tile.picSummary = StringUtil.addEmptySpaces([tile.picDateTaken, FileUtil.truncateFileName(tile.fileName)]);
        let name = StringUtil.addEmptySpaces([tile.picSummary, tile.fileSize, tile.cameraSettings]);
        // infoHash changes while an upload is seeded; a stable key keeps the
        // tile mounted instead of reloading its image each time.
        const key = tile.tileKey || tile.infoHash || index;

        return <TileErrorBoundary key={key} fileName={tile.fileName} resetKey={!!tile.loading}>
            {tile.loading
                ? <LoadingTile name={name} tile={tile}
                               master={master}/>
                : <ContentTile name={name} tile={tile}
                               master={master}
                               selected={selectedIndex === index}
                               hero={tiles.length === 1}
                               onOpen={() => openAt(index)} />}
        </TileErrorBoundary>;
    }, [openAt, selectedIndex, tiles.length]);

    return (
        <Box
            onDragEnter={handleDragEnter}
            onDragLeave={handleDragLeave}
            onDragOver={handleDragOver}
            onDrop={handleDrop}
            sx={{
                position: 'relative',
                width: '100%',
                minHeight: tiles.length === 0 ? '60vh' : undefined,
                backgroundColor: 'background.default',
            }}
        >
            {tiles.length === 0 && !roomSynced ? (
                <>
                <Box sx={{ display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 1.5, py: 6 }}>
                    {!roomSyncTimedOut && <CircularProgress size={18} thickness={4} />}
                    <Typography variant="body2" sx={{ color: 'text.secondary' }}>
                        {roomSyncTimedOut
                            ? 'This room is taking longer to load. Check your connection.'
                            : "Loading this room's photos…"}
                    </Typography>
                </Box>
                {roomSyncTimedOut && <AddPhotosStrip narrow />}
                </>
            ) : tiles.length === 0 ? (
                <>
                <Box
                    component="label"
                    htmlFor="contained-button-file"
                    className="drop-target"
                    sx={{ minHeight: 'min(40vh, 360px) !important' }}
                >
                    <CloudUploadIcon sx={{ fontSize: 40, mb: 1.5, color: 'primary.main' }} />
                    <Typography className="tech-text" sx={{ mb: 1, color: 'primary.main' }}>
                        Drop or choose
                    </Typography>
                    <Typography variant="h6" sx={{ color: 'text.primary', mb: 0.5, fontWeight: 600 }}>
                        Share a photo
                    </Typography>
                    <Typography variant="body2" sx={{ color: 'text.secondary' }}>
                        Drop pictures here, or tap to choose some from this device.
                    </Typography>
                </Box>
                {showNetworkReadout && (
                    <Box sx={{ maxWidth: 560, mx: 'auto' }}>
                        <NetworkReadout master={master} />
                    </Box>
                )}
                </>
            ) : (
                <>
                {/* The empty-state drop zone, shrunk to one line once there are photos. */}
                <AddPhotosStrip narrow={tiles.length < 2} />
                <Box
                    className="stagger-children"
                    sx={{
                        columnCount: tiles.length < 2 ? 1 : { xs: 1, sm: 2, xl: 3 },
                        columnGap: theme.spacing(2),
                        width: '100%',
                        maxWidth: tiles.length < 2 ? 880 : 'none',
                        mx: tiles.length < 2 ? 'auto' : 0,
                        padding: theme.spacing(0, 0, 3),
                        '& > *': {
                            breakInside: 'avoid',
                            marginBottom: theme.spacing(2),
                        },
                    }}
                >
                    {tiles.map((tile, index) => buildTile(tile, index, master))}
                </Box>
                </>
            )}

            {dragOver && (
                <Box
                    className="drop-target"
                    sx={{
                        position: 'absolute',
                        inset: 0,
                        zIndex: 20,
                        minHeight: 0,
                        borderRadius: 2,
                        backgroundColor: 'var(--accent-soft)',
                        backdropFilter: 'blur(6px)',
                        pointerEvents: 'none',
                    }}
                >
                    <CloudUploadIcon sx={{ fontSize: 48, color: 'primary.main', mb: 1 }} />
                    <Typography variant="subtitle1" sx={{ color: 'primary.main' }}>
                        Drop files to share
                    </Typography>
                </Box>
            )}

            {selectedIndex != null && tiles[selectedIndex] && (
                <PhotoViewer
                    master={master}
                    tiles={tiles}
                    index={selectedIndex}
                    onClose={closeViewer}
                    onIndexChange={showIndex}
                />
            )}
        </Box>
    );
}

Gallery.propTypes = {
    master: PropTypes.object.isRequired,
    showNetworkReadout: PropTypes.bool,
};
export default withSnackbar(Gallery);
