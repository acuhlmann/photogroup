import React, { Component } from 'react';
import PropTypes from 'prop-types';
import {withStyles} from '@material-ui/core/styles';

import GridListTile from '@material-ui/core/GridListTile';
import Button from "@material-ui/core/Button/Button";
import PasswordInput from "../security/PasswordInput";
import Logger from 'js-logger';
import FileUtil from '../util/FileUtil';
import {withSnackbar} from "notistack";
import update from "immutability-helper";
import _ from "lodash";
import Encrypter from "../security/Encrypter";
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
});

class Gallery extends Component {

    constructor(props) {
        super(props);

        this.state = {
           tiles : [],
        };

        props.master.emitter.on('torrentReady', photos => {
            this.addMediaToDom(photos);
        }, this);

        const emitter = props.master.emitter;
        const self = this;

        this.photoHandler = new GalleryPhotoHandler(this, emitter);
        this.photoHandler.sync();

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

        const { classes } = props;
        this.classes = classes;
    }

    addMediaToDom(photos) {

        const isSeeding = photos[0].seed;
        if(isSeeding) {
            const tiles = photos.map(photo => this.mergeEasyToGetMetadata(photo, photo.file));
            this.renderTile(tiles, isSeeding);
        } else {

            const photoPromises = photos.map(photo => {
                return new Promise((resolve, reject) => {
                    const ext = photo.torrentFile.name.split('.').pop().toLowerCase();
                    if(ext !== 'mp4') {
                        photo.torrentFile.getBlob((err, elem) => {
                            if (err) {
                                Logger.error(err.message);
                                reject(err.message);
                            } else {
                                resolve(this.mergeEasyToGetMetadata(photo, elem));
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
                        resolve(this.mergeStreamingMetadata(photo));
                    }
                });
            });

            Promise.all(photoPromises).then(results => {
                this.renderTile(results, isSeeding);
            });
        }
    }

    mergeStreamingMetadata(photo) {
        photo.elem = null;
        photo.img = null;
        photo.fileSize = photo.fileSize || FileUtil.formatBytes(photo.torrentFile.length);
        photo.isVideo = true;
        photo.isImage = false;
        photo.fileName = FileUtil.truncateFileName(photo.torrentFile.name);
        photo.picSummary = photo.picSummary || (StringUtil.addEmptySpaces([photo.picDateTaken, photo.fileName]));
        return photo;
    }

    mergeEasyToGetMetadata(photo, file) {
        photo.loading = false;
        photo.elem = file;
        photo.img = URL.createObjectURL(file);
        photo.fileSize = photo.fileSize || FileUtil.formatBytes(photo.elem.size);
        photo.isVideo = photo.elem.type.includes('video/');
        photo.isImage = photo.elem.type.includes('image/');
        photo.isAudio = photo.elem.type.includes('audio/');
        photo.fileName = file.name;
        photo.picSummary = photo.picSummary || (StringUtil.addEmptySpaces([photo.picDateTaken, photo.fileName]));
        return photo;
    }

    renderTile(photos, isSeeding) {

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

            if(!isSeeding) {

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

    decrypt(tile, password, index) {
        const file = tile.file;
        const elem = tile.elem;
        const torrent = tile.torrent;
        const self = this;

        Encrypter.decryptPic(elem, password, (blob) => {

            self.setState(state => {
                const tiles = update(state.tiles, {$splice: [[index, 1]]});
                return {tiles: tiles}
            }, () => {
                self.renderTo(file, blob, torrent, false);
            });
        });
    }

    buildTile(tile, index, classes, master) {

        let name = StringUtil.addEmptySpaces([tile.picSummary, tile.fileSize, tile.cameraSettings]);
        //tile.loading = true;
        if(tile.secure) {

            return <GridListTile key={index} cols={tile.cols || 1}>
                <div>Decrypt with</div>
                <PasswordInput onChange={value => this.setState({password: value})}/>
                <Button onClick={this.decrypt.bind(this, tile, this.state.password, index)}
                        color="primary">
                    Submit
                </Button>
            </GridListTile>;
        } else if(tile.loading) {

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

        const hasImages = tiles && tiles.find(tile => !tile.isLoading && !tile.secure && tile.img);
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
    classes: PropTypes.object.isRequired,
    master: PropTypes.object.isRequired,
};
export default withSnackbar(withStyles(styles)(Gallery));