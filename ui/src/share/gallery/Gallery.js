import React, { useState, useEffect, useRef, useCallback } from 'react';
import PropTypes from 'prop-types';
import { useTheme } from '@mui/material/styles';
import Box from '@mui/material/Box';
import Typography from '@mui/material/Typography';
import CircularProgress from '@mui/material/CircularProgress';
import CloudUploadIcon from '@mui/icons-material/CloudUploadRounded';
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
import GalleryToolbar from "./GalleryToolbar";
import RoomMap from "./RoomMap";
import DownloadRoomButton from "./DownloadRoomButton";
import AndroidLocationNote from "./AndroidLocationNote";
import { arrangeTiles, DEFAULT_VIEW } from "./arrangeTiles";
import { onPlaceName, reverseGeocode } from "./metadata/geo";
import { captureDroppedHandles } from "./replaceOriginal";
import { openSealedPhoto } from "./openSealed";
import SimpleGrid from "../simple/SimpleGrid";
import ChooseToSave from "./ChooseToSave";
import { setPosterSink } from "./tilePreview";
import { CLIP_SIZE_NOTE } from "../torrent/ServerCopyLimits";

/** A tile's identity across updates; an upload's infoHash changes once it is hashed. */
const tileKeyOf = tile => tile.tileKey || tile.infoHash;

/**
 * Display room tiles, accept dropped uploads, and open the media viewer.
 * An unsynced empty gallery waits for a snapshot or four seconds before showing the upload prompt.
 * `showNetworkReadout` controls the readout in the empty state and defaults to true.
 * `variant` "simple" swaps the tiles for big squares with a Save button each.
 * `onTilesChange` hears every change to the tiles, for views that draw them elsewhere.
 */
function Gallery(props) {
    const {master, showNetworkReadout = true, variant = 'full', onTilesChange} = props;
    const theme = useTheme();
    const [tiles, setTiles] = useState([]);
    const [dragOver, setDragOver] = useState(false);
    // The open photo is tracked by key: sorting, filtering or an edit can move it in the list.
    const [selectedKey, setSelectedKey] = useState(null);
    const lastIndex = useRef(0);
    const [view, setView] = useState(DEFAULT_VIEW);
    const [mode, setMode] = useState('grid');
    // Re-arrange when a place name arrives, since places can be filtered on.
    const [, setPlaceNames] = useState(0);
    useEffect(() => onPlaceName(() => setPlaceNames(count => count + 1)), []);
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
        const files = Array.from((e.dataTransfer && e.dataTransfer.files) || []);
        if (files.length > 0) {
            // Through the uploader, so drops get what a pick from Share gets:
            // encryption when it's on, and on Android zips unpacked and blanked locations held back.
            captureDroppedHandles(e.dataTransfer).then(() => {
                master.emitter.emit('filesSelected', files);
            });
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

    /** A received file: a private room's photo is opened with the room key first. */
    const finish = useCallback((photo, file) => {
        if (!photo.secure || photo.isDecrypted) return mergePostloadMetadata(photo, file);
        return openSealedPhoto(photo, file)
            .then(plain => mergePostloadMetadata(photo, plain))
            .catch(err => {
                Logger.warn('Cannot open ' + (photo.fileName || photo.infoHash) + ': ' + err.message);
                photo.sealedError = err.message;
                photo.loading = false;
                return photo;
            });
    }, [mergePostloadMetadata]);

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
                    // "Data saver": only the preview until the person asks for the photo.
                    if (photo.previewOnly) {
                        reject('preview only');
                        return;
                    }
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
                                resolve(finish(photo, file));
                                return;
                            }
                        } catch (cacheErr) {
                            Logger.warn('addMediaToDom: blob cache lookup failed, falling through: ' + cacheErr);
                        }
                    }

                    // Fetched from the server copy (clips aren't in the image
                    // cache): the file is here, even with no torrent behind it.
                    if (photo.fromServerCopy && photo.cachedFile) {
                        resolve(finish(photo, photo.cachedFile));
                        return;
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
                                    resolve(finish(photo, file));
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
                                        resolve(finish(photo, file));
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
                                resolve(finish(photo, file));
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
    }, [master, getBlob, mergePreloadMetadata, mergePostloadMetadata, finish, renderTile, mergeStreamingMetadata]);

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

    // Frames this device grabs of clips shared without a preview go to the room.
    useEffect(() => {
        setPosterSink((tile, poster) => {
            const service = master.service;
            if (!service || typeof service.sharePoster !== 'function') return;
            if (!tile.infoHash || tile.isFake || tile.secure) return;
            service.sharePoster(tile.infoHash, poster)
                .then(saved => saved && master.emitter.emit('photos', { type: 'update', item: [saved] }))
                .catch(err => Logger.warn(err && err.message ? err.message : String(err)));
        });
        return () => setPosterSink(null);
    }, [master]);

    // Geek mode draws the photos on its network map instead of this grid.
    useEffect(() => {
        if (onTilesChange) onTilesChange(tiles);
    }, [tiles, onTilesChange]);

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

    // The viewer, the grid and the map all work on the tiles the current view shows.
    const arranged = arrangeTiles(tiles, view, master);
    const visible = arranged.tiles;

    // A photo an edit filters out stays open where it was until the viewer moves on.
    let viewerTiles = visible;
    let selectedIndex = selectedKey == null ? -1 : visible.findIndex(tile => tileKeyOf(tile) === selectedKey);
    if (selectedIndex < 0 && selectedKey != null) {
        const kept = tiles.find(tile => tileKeyOf(tile) === selectedKey);
        if (kept) {
            selectedIndex = Math.min(lastIndex.current, visible.length);
            viewerTiles = [...visible.slice(0, selectedIndex), kept, ...visible.slice(selectedIndex)];
        }
    }
    if (selectedIndex < 0) selectedIndex = null;
    useEffect(() => {
        if (selectedIndex != null) lastIndex.current = selectedIndex;
    });

    const openAt = useCallback((tile) => {
        setSelectedKey(tile ? tileKeyOf(tile) : null);
    }, []);

    const showIndex = useCallback((index) => {
        const tile = viewerTiles[index];
        if (tile) setSelectedKey(tileKeyOf(tile));
    }, [viewerTiles]);

    const closeViewer = useCallback(() => {
        setSelectedKey(null);
    }, []);

    // Anything else showing photos (the geek map) asks the gallery to open one.
    useEffect(() => {
        const handleOpen = key => setSelectedKey(key);
        master.emitter.on('openPhoto', handleOpen);
        return () => master.emitter.removeListener('openPhoto', handleOpen);
    }, [master.emitter]);
    const located = visible.filter(tile => arranged.facts.get(tile)?.location).map(tile => {
        const facts = arranged.facts.get(tile);
        return { tile, location: facts.location, label: facts.title || tile.fileName || 'photo', takenAt: facts.takenAt };
    });

    // Look up place names for located photos, so "Place" can offer them even before tiles do.
    const unnamed = located.filter(item => !arranged.facts.get(item.tile).place)
        .map(item => `${item.location.lat},${item.location.long}`).join('|');
    useEffect(() => {
        unnamed.split('|').filter(Boolean).forEach(key => {
            const [lat, long] = key.split(',').map(Number);
            reverseGeocode(lat, long);
        });
    }, [unnamed]);

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
                               selected={selectedKey != null && tileKeyOf(tile) === selectedKey}
                               hero={visible.length === 1}
                               onOpen={() => openAt(tile)} />}
        </TileErrorBoundary>;
    }, [openAt, selectedKey, visible.length]);

    const showError = useCallback(message => master.emitter.emit('showError', message), [master.emitter]);

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
                </>
            ) : variant === 'simple' ? (
                <SimpleGrid tiles={tiles} roomId={master.service && master.service.id} onError={showError} />
            ) : tiles.length === 0 ? (
                <>
                <Box
                    component="label"
                    htmlFor="contained-button-file"
                    className="drop-target"
                    sx={{ minHeight: 'min(40vh, 360px) !important' }}
                >
                    <CloudUploadIcon sx={{ fontSize: 40, mb: 1.5, color: 'primary.main' }} />
                    <Typography variant="h6" sx={{ color: 'text.primary', mb: 0.5, fontWeight: 600 }}>
                        Add photos and clips
                    </Typography>
                    <Typography variant="body2" sx={{ color: 'text.secondary' }}>
                        Drop them here, or tap to pick them on this device. All people in the room get them.
                    </Typography>
                    <Typography variant="caption" sx={{ color: 'text.secondary', mt: 1, maxWidth: 420 }}>
                        {CLIP_SIZE_NOTE}
                    </Typography>
                </Box>
                <AndroidLocationNote narrow />
                {showNetworkReadout && (
                    <Box sx={{ maxWidth: 560, mx: 'auto' }}>
                        <NetworkReadout master={master} />
                    </Box>
                )}
                </>
            ) : (
                <>
                {/* Add more with the header's Add photos button, or drop them anywhere here. */}
                <AndroidLocationNote narrow={tiles.length < 2} />
                {tiles.length > 1 && (
                    <GalleryToolbar
                        view={view}
                        onChange={setView}
                        mode={mode}
                        onModeChange={setMode}
                        places={arranged.places}
                        unplaced={arranged.unplaced}
                        shown={visible.length}
                        total={arranged.total}
                        actions={<>
                            <ChooseToSave tiles={visible} roomId={master.service && master.service.id} />
                            <DownloadRoomButton tiles={tiles} roomId={master.service && master.service.id} />
                        </>}
                    />
                )}
                {mode === 'map' && tiles.length > 1 && (
                    <RoomMap items={located} unplaced={visible.length - located.length}
                        onOpen={openAt} />
                )}
                {visible.length === 0 && (
                    <Typography variant="body2" sx={{ color: 'text.secondary', textAlign: 'center', py: 4 }}>
                        No photos match these filters.
                    </Typography>
                )}
                {(mode === 'grid' || tiles.length < 2) && <Box
                    className="stagger-children"
                    sx={{
                        columnCount: visible.length < 2 ? 1 : { xs: 1, sm: 2, xl: 3 },
                        columnGap: theme.spacing(2),
                        width: '100%',
                        maxWidth: visible.length < 2 ? 880 : 'none',
                        mx: visible.length < 2 ? 'auto' : 0,
                        padding: theme.spacing(0, 0, 3),
                        '& > *': {
                            breakInside: 'avoid',
                            marginBottom: theme.spacing(2),
                        },
                    }}
                >
                    {visible.map((tile, index) => buildTile(tile, index, master))}
                </Box>}
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
                        Drop to add them to the room
                    </Typography>
                </Box>
            )}

            {selectedIndex != null && (
                <PhotoViewer
                    master={master}
                    tiles={viewerTiles}
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
    variant: PropTypes.oneOf(['full', 'simple']),
    onTilesChange: PropTypes.func,
};
export default withSnackbar(Gallery);
