import React, { Component } from 'react';
import PropTypes from 'prop-types';
import {withStyles} from '@material-ui/core/styles';

import GridListTile from '@material-ui/core/GridListTile';
import moment from 'moment';
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

        this.syncWithPhotos();

        props.master.emitter.on('torrentReady', item => {
            this.addMediaToDom(item);
        }, this);

        const emitter = props.master.emitter;
        const self = this;
        //When webtorrent errors on a duplicated add, try to remove and re-seed.
        //This may happen if client state is lost
        //i.e. due to removal of browser (indexeddb cache)
        emitter.on('duplicate', duplicated => {
            let tiles = this.state.tiles;
            const index = tiles.findIndex(item => item.infoHash === duplicated.photo.infoHash);
            if(index > -1) {
                tiles = update(tiles, {$splice: [[index, 1]]});
                self.setState({tiles: tiles});
            }
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

    addMediaToDom(item) {

        if(item.seed) {
            item.elem = item.file;
            item.img = URL.createObjectURL(item.file);
            this.renderTile(item);
        } else {
            item.torrentFile.getBlob((err, elem) => {
                if (err) {
                    Logger.error(err.message);
                } else {
                    item.elem = elem;
                    item.img = URL.createObjectURL(elem);
                    this.renderTile(item);
                }
            });
        }
    }

    async renderTile(newTile) {
        newTile.fileSize = newTile.fileSize || FileUtil.formatBytes(newTile.elem.size);
        newTile.isVideo = newTile.elem.type.includes('video/');
        newTile.isImage = newTile.elem.type.includes('image/');
        newTile.fileName = newTile.torrent.name;

        let tiles;
        const oldTiles = this.state.tiles;
        const index = oldTiles.findIndex(item => item.infoHash === newTile.infoHash);
        if(index > -1) {
            newTile = _.merge(oldTiles[index], newTile);
            tiles = update(oldTiles, {$splice: [[index, 1, newTile]]});
        } else {
            tiles = update(oldTiles, {$unshift: [newTile]});
        }
        this.setState({tiles: tiles});

        if(!newTile.seed) {

            this.props.master.emitter.emit('torrentDone', newTile.torrent);
            await this.props.master.service.updateOwner(newTile.infoHash, {
                peerId: this.props.master.client.peerId,
                loading: false
            });
            Logger.info('owner downloaded ' + newTile.torrent.name);
            /*this.props.master.emitter.emit('appEventRequest', {level: 'success', type: 'downloaded',
                event: {file: item.torrent.name, sharedBy: item.sharedBy, downloader: this.props.master.client.peerId}
            });*/
        }
    }

    sortPictures(photos, format) {
        photos.sort((a, b) => {
            const dateA = moment(a.picDateTaken, format).toDate();
            const dateB = moment(b.picDateTaken, format).toDate();
            return dateB - dateA;
        });
    }

    syncWithPhotos() {
        const master = this.props.master;
        master.emitter.on('photos', event => {

            const oldTiles = this.state.tiles;

            if(event.type === 'all') {

                ((oldTiles, photos) => {

                    photos.forEach(item => {
                        item.loading = true;
                    });
                    const format = 'HH:mm:ss MMM Do YY';
                    this.sortPictures(photos, format);
                    this.setState({tiles: photos});

                })(oldTiles, event.item);

            } else if(event.type === 'add') {

                ((oldTiles) => {
                    const index = oldTiles.findIndex(item => item.infoHash === event.item.infoHash);
                    if(index < 0) {

                        const tile = event.item;
                        tile.loading = true;
                        const format = 'HH:mm:ss MMM Do YY';
                        if(!tile.picDateTaken && tile.file && tile.file.lastModified) {
                            tile.picDateTaken = moment(tile.file.lastModified).format(format);
                        }
                        const tiles = update(oldTiles, {$unshift: [tile]});
                        this.sortPictures(tiles, format);
                        this.setState({tiles: tiles});
                    }
                })(oldTiles);

            } else if(event.type === 'delete') {

                master.emitter.emit('disconnectNode', event.item);

                ((oldTiles) => {
                    const index = oldTiles.findIndex(item => item.infoHash === event.item);
                    if(index > -1) {
                        const tiles = update(oldTiles, {$splice: [[index, 1]]});
                        this.setState({tiles: tiles});
                    }
                })(oldTiles);

            } else if(event.type === 'update') {

                ((oldTiles) => {
                    const index = oldTiles.findIndex(item => item.infoHash === event.item.infoHash);
                    if(index > -1) {

                        const newTile = update(oldTiles[index], {$merge: event.item});
                        const tiles = update(oldTiles, {$splice: [[index, 1, newTile]]});
                        this.setState({tiles: tiles});
                    }
                })(oldTiles);

            } else if(event.type === 'addOwner') {

                ((oldTiles) => {

                    const index = oldTiles.findIndex(item => item.infoHash === event.item.infoHash);
                    if(index > -1) {
                        const oldOwners = oldTiles[index].owners;
                        const ownersIndex = oldOwners.findIndex(item => item.peerId === event.item.peerId);
                        if(ownersIndex < 0) {
                            delete event.item.infoHash;
                            const owners = update(oldOwners, {$push: [event.item]});
                            const tile = update(oldTiles[index], {owners: {$set: owners}});
                            const tiles = update(oldTiles, {$splice: [[index, 1, tile]]});
                            this.setState({tiles: tiles});
                        }
                    }

                })(oldTiles);

            } else if(event.type === 'removeOwner') {

                ((oldTiles) => {

                    let tiles = oldTiles;
                    oldTiles.forEach((oldTile, tileIndex) => {

                        const ownerIndex = oldTile.owners.findIndex(owner => owner.peerId === event.item);
                        if(ownerIndex > -1) {
                            const owners = update(oldTile.owners, {$splice: [[ownerIndex, 1]]});
                            const tile = update(oldTiles[tileIndex], {owners: {$set: owners}});
                            tiles = update(oldTiles, {$splice: [[tileIndex, 1, tile]]});
                            //this.setState({tiles: tiles});
                        }
                    });

                    this.setState({tiles: tiles});

                })(oldTiles);

            } else if(event.type === 'updateOwner') {

                ((oldTiles) => {

                    const index = oldTiles.findIndex(item => item.infoHash === event.item.infoHash);
                    if(index > -1) {
                        const oldOwners = oldTiles[index].owners;
                        const ownersIndex = oldOwners.findIndex(item => item.peerId === event.item.peerId);
                        if(ownersIndex > -1) {
                            delete event.item.infoHash;
                            const owners = update(oldOwners, {$splice: [[ownersIndex, 1, event.item]]});
                            const tile = update(oldTiles[index], {owners: {$set: owners}});
                            const tiles = update(oldTiles, {$splice: [[index, 1, tile]]});
                            this.setState({tiles: tiles});
                        }
                    }

                })(oldTiles);
            }
        });
    }

    decrypt(tile, password, index) {
        const file = tile.file;
        const elem = tile.elem;
        const torrent = tile.torrent;
        const scope = this;

        Encrypter.decryptPic(elem, password, (blob) => {
            const tiles = update(scope.view.state.tiles, {$splice: [[index, 1]]});
            scope.view.setState({
                tiles: tiles
            });
            scope.renderTo(file, blob, torrent, false);
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

        const hasImages = tiles.find(tile => !tile.isLoading && !tile.secure && tile.img);
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