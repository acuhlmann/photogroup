import React, { useState, useEffect, useRef, useCallback } from 'react';
import PropTypes from 'prop-types';
import {withStyles} from '@mui/styles';
import Logger from 'js-logger';
import FileUtil from '../util/FileUtil';
import {withSnackbar} from "../compatibility/withSnackbar";
import update from "immutability-helper";
import _ from "lodash";
import LoadingTile from "./LoadingTile";
import StringUtil from "../util/StringUtil";
import ContentTile from "./ContentTile";
import GalleryPhotoHandler from "./GalleryPhotoHandler";

const styles = theme => ({
    root: {
        display: 'flex',
        flexWrap: 'wrap',
        justifyContent: 'space-around',
        width: '100%',
        backgroundColor: theme.palette.background.paper,
    },
    white: {
        color: '#ffffff'
    },
    horizontal: {
        display: 'flex',
        flexDirection: 'row',
        alignItems: 'center',
        justifyContent: 'center'
    },
    vertical: {
        display: 'flex',
        flexDirection: 'column'
    },
});

function Gallery(props) {
    const {master, classes} = props;
    const [tiles, setTiles] = useState([]);
    const photoHandlerRef = useRef(null);

    const getBlob = useCallback((photo) => {
        if(photo.file && photo.file instanceof Blob) {
            photo.elem = photo.file;
            Logger.info('blobDone dispatch ' + photo.fileName);
            master.emitter.emit('blobDone-' + photo.infoHash, photo);
        } else {
            photo.torrentFile.getBlob((err, elem) => {
                photo.elem = elem;
                Logger.info('blobDone dispatch ' + photo.fileName);
                master.emitter.emit('blobDone-' + photo.infoHash, photo);
            });
        }
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
        photo.img = URL.createObjectURL(file);
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
                // getBlob will also emit blobDone event (may be redundant but safe)
                getBlob(photo);
            });
            renderTile(photos, isSeeding);
        } else {
            const photoPromises = photos.map(photo => {
                return new Promise((resolve, reject) => {
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
                        getBlob(photo);
                        resolve(mergeStreamingMetadata(photo, extention));
                    }
                });
            });

            renderTile(photos, false, false);

            Promise.all(photoPromises).then(results => {
                renderTile(results, false, true);
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
        photoHandlerRef.current.sync();
        
        // Emit initial gallery state
        updateGalleryState();

        return () => {
            emitter.removeListener('torrentReady', handleTorrentReady);
            emitter.removeListener('duplicate', handleDuplicate);
        };
    }, [master, updateGalleryState, addMediaToDom]);

    useEffect(() => {
        updateGalleryState();
    }, [tiles, updateGalleryState]);

    const buildTile = useCallback((tile, index, classes, master) => {
        tile.picSummary = StringUtil.addEmptySpaces([tile.picDateTaken, FileUtil.truncateFileName(tile.fileName)]);
        let name = StringUtil.addEmptySpaces([tile.picSummary, tile.fileSize, tile.cameraSettings]);

        if(tile.loading) {
            return <LoadingTile key={index} name={name} tile={tile}
                                master={master}/>
        } else {
            return <ContentTile key={index} name={name} tile={tile}
                                master={master} />
        }
    }, []);

    return (
        <div>
            <div>
                {tiles.map((tile, index) => buildTile(tile, index, classes, master))}
            </div>
        </div>
    );
}

Gallery.propTypes = {
    master: PropTypes.object.isRequired,
};
export default withSnackbar(withStyles(styles)(Gallery));