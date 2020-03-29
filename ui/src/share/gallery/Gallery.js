import React, { Component } from 'react';
import PropTypes from 'prop-types';
import {withStyles} from '@material-ui/core/styles';
import Logger from 'js-logger';
import FileUtil from '../util/FileUtil';
import {withSnackbar} from "notistack";
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

class Gallery extends Component {

    constructor(props) {
        super(props);

        this.state = {
           tiles : [],
        };

        this.classes = props.classes;
    }

    componentDidMount() {

        const emitter = this.props.master.emitter;

        emitter.on('torrentReady', photos => {
            this.addMediaToDom(photos);
        }, this);

        //When webtorrent errors on a duplicated add, try to remove and re-seed.
        //This may happen if client state is lost
        //i.e. due to removal of browser (indexeddb cache)
        emitter.on('duplicate', duplicated => {

            this.setState(state => {
                let tiles = state.tiles;
                duplicated.photos.forEach(photo => {
                    const index = tiles.findIndex(item => item.infoHash === photo.infoHash);
                    if(index > -1) {
                        tiles = update(tiles, {$splice: [[index, 1]]});
                    }
                });
                return {tiles: tiles};
            });

            //const tile = tiles.find(item => item.infoHash === duplicated.torrentId);
            /*if(tile) {
                Logger.info('duplicate ' + tile.infoHash);
                duplicated.torrent.client.remove(duplicated.torrentId, () => {
                    if(duplicated.file) {
                        self.props.master.torrentAddition.seed(duplicated.file, undefined, duplicated.file, () => {
                            Logger.info('seeded duplicate');
                        });
                    }
                });
            }*/
        }, this);

        this.photoHandler = new GalleryPhotoHandler(this, emitter);
        this.photoHandler.sync();
    }

    addMediaToDom(photos) {

        const isSeeding = photos[0].seed;
        if(isSeeding) {
            photos.forEach(photo => {
                this.mergePreloadMetadata(photo);
                this.mergePostloadMetadata(photo, photo.file, true);
                this.getBlob(photo);
            });
            this.renderTile(photos, isSeeding);
        } else {

            const photoPromises = photos.map(photo => {
                return new Promise((resolve, reject) => {

                    /*const stream = photo.torrentFile.createReadStream();
                    stream.on('data', (chunk) => {
                        console.log(`Received ${chunk.length} bytes of data.`);

                        exifr.thumbnailUrl(chunk)
                            .then(output => {
                                if(output) {
                                    Logger.info('FOOOOUUUUND:', output);
                                }
                            })
                            .catch(e => {
                                Logger.error('exifr.thumbnail:', e);
                            })
                    });
                    stream.on('end', () => {
                        console.log('There will be no more data.');
                    });*/

                    const extention = photo.torrentFile.name.split('.').pop().toLowerCase();
                    if(!this.props.master.STREAMING_FORMATS.includes(extention) || photo.secure) {
                        Logger.info('getBlob ' + photo.torrent.name);
                        this.mergePreloadMetadata(photo);
                        photo.torrentFile.getBlob((err, elem) => {
                            Logger.info('getBlob done ' + photo.torrent.name);
                            if (err) {
                                Logger.error(err.message);
                                reject(err.message);
                            } else {
                                const file = new File([elem], photo.fileName, { type: photo.fileType });
                                resolve(this.mergePostloadMetadata(photo, file));
                            }
                        });
                    } else {
                        /*
                        const stream = photo.torrentFile.createReadStream();
                        stream.on('data', (chunk) => {
                            console.log(`Received ${chunk.length} bytes of data.`);
                        });
                        stream.on('end', () => {
                            console.log('There will be no more data.');
                        });
                        */
                        this.getBlob(photo);
                        resolve(this.mergeStreamingMetadata(photo, extention));
                    }
                });
            });

            this.renderTile(photos, false, false);

            Promise.all(photoPromises).then(results => {
                this.renderTile(results, false, true);
            });
        }
    }

    getBlob(photo) {
        const self = this;
        if(photo.file && photo.file instanceof Blob) {
            photo.elem = photo.file;
            Logger.info('blobDone dispatch ' + photo.fileName);
            self.props.master.emitter.emit('blobDone-' + photo.infoHash, photo);
        } else {
            photo.torrentFile.getBlob((err, elem) => {
                photo.elem = elem;
                Logger.info('blobDone dispatch ' + photo.fileName);
                self.props.master.emitter.emit('blobDone-' + photo.infoHash, photo);
            });
        }
    }

    mergeStreamingMetadata(photo, extention) {
        photo.loading = photo.rendering = false;
        photo.elem = null;
        photo.img = null;
        photo.fileSize = photo.fileSize || FileUtil.formatBytes(photo.torrentFile.length);
        photo.isVideo = this.props.master.STREAMING_VIDEO_FORMATS.includes(extention);
        photo.isAudio = this.props.master.STREAMING_AUDIO_FORMATS.includes(extention);
        photo.isImage = false;
        //photo.fileName = FileUtil.truncateFileName(photo.torrentFile.name);
        //photo.picSummary = photo.picSummary || (StringUtil.addEmptySpaces([photo.picDateTaken, photo.fileName]));
        return photo;
    }

    mergePreloadMetadata(photo) {
        //photo.fileName = FileUtil.truncateFileName(photo.torrentFile.name);
        //photo.picSummary = photo.picSummary || (StringUtil.addEmptySpaces([photo.picDateTaken, photo.fileName]));
    }

    mergePostloadMetadata(photo, file, noElem) {
        photo.loading = photo.rendering = false;
        photo.elem = noElem ? null : file;
        photo.img = URL.createObjectURL(file);
        photo.fileSize = photo.fileSize || FileUtil.formatBytes(noElem ? photo.torrentFile.length : photo.elem.size);
        photo.isVideo = photo.fileType.includes('video/');
        photo.isImage = photo.fileType.includes('image/');
        photo.isAudio = photo.fileType.includes('audio/');
        //photo.fileName = FileUtil.truncateFileName(file.name);
        //photo.fileType = file.type;
        //photo.fileNameFull = file.name;
        //photo.picSummary = photo.picSummary || (StringUtil.addEmptySpaces([photo.picDateTaken, photo.fileName]));
        return photo;
    }

    renderTile(photos, isSeeding, updateOwner) {

        this.setState((state, props) => {

            const oldTiles = state.tiles;
            let tiles = oldTiles;
            photos.forEach(photo => {
                const index = oldTiles.findIndex(item => item.infoHash === photo.infoHash);
                if(index > -1) {
                    photo = _.merge(oldTiles[index], photo);
                    update(oldTiles, {$splice: [[index, 1, photo]]});
                } else {
                    tiles = update(oldTiles, {$unshift: [photo]});
                }
            });

            if(!isSeeding && updateOwner) {

                tiles.forEach(photo => {
                    this.props.master.service.updateOwner([{
                        infoHash: photo.infoHash,
                        peerId: this.props.master.client.peerId,
                        loading: false
                    }]).then(() => {
                        //Logger.info('owner registered ' + photo.torrent.name)
                    })
                });
            }

            return {tiles: tiles};
        });
    }

    async handleDelete(tile) {
        const result = await this.props.master.torrentDeletion.deleteItem(tile);
        Logger.info('handleDelete ' + result);
    }

    buildTile(tile, index, classes, master) {

        tile.picSummary = StringUtil.addEmptySpaces([tile.picDateTaken, FileUtil.truncateFileName(tile.fileName)]);
        let name = StringUtil.addEmptySpaces([tile.picSummary, tile.fileSize, tile.cameraSettings]);
        //tile.loading = true;

        if(tile.loading) {

            return <LoadingTile key={index} name={name} tile={tile}
                                master={master}/>

        } else {

            return <ContentTile key={index} name={name} tile={tile}
                                master={master} />
        }
    }

    render() {
        const {classes, master} = this.props;
        const {tiles} = this.state;

        const hasImages = tiles && tiles.find(tile => !tile.isLoading && tile.img);
        if(hasImages) {
            master.emitter.emit('galleryHasImages', true);
        } else {
            master.emitter.emit('galleryHasImages', false);
        }
        return (
            <div>
                <div>
                    {tiles.map((tile, index) => this.buildTile(tile, index, classes, master))}
                </div>
            </div>
        );
    }
}

Gallery.propTypes = {
    master: PropTypes.object.isRequired,
};
export default withSnackbar(withStyles(styles)(Gallery));