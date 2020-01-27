import React, { Component } from 'react';
import PropTypes from 'prop-types';
import {withStyles} from '@material-ui/core/styles';

import GridListTile from '@material-ui/core/GridListTile';
import moment from 'moment';
import Button from "@material-ui/core/Button/Button";
import PasswordInput from "../security/PasswordInput";

import IconButton from '@material-ui/core/IconButton';
import InfoIcon from '@material-ui/icons/Info';
import DeleteIcon from '@material-ui/icons/Delete';
//import CloudUploadIcon from '@material-ui/icons/CloudUpload';
import CloudDownloadIcon from '@material-ui/icons/CloudDownload';
import Typography from "@material-ui/core/Typography";
import Paper from "@material-ui/core/Paper";

import download from 'downloadjs';
import Logger from 'js-logger';
import FileUtil from '../util/FileUtil';
import PhotoDetails from './PhotoDetails';
import {withSnackbar} from "notistack";
import update from "immutability-helper";
import _ from "lodash";
import Divider from "@material-ui/core/Divider";
import CheckIcon from "@material-ui/icons/CheckRounded";
import ImageIcon from "@material-ui/icons/ImageRounded";
import CircularProgress from "@material-ui/core/CircularProgress";
import MetadataParser from "./MetadataParser";
import Encrypter from "../security/Encrypter";
import OwnersList from "./OwnersList";

const styles = theme => ({
    root: {
        display: 'flex',
        flexWrap: 'wrap',
        justifyContent: 'space-around',
        width: '100%',
        backgroundColor: theme.palette.background.paper,
    },
    gridList: {
        marginBottom: '-5px'
    },

    toolbar: {
        display: 'flex',
        alignItems: 'center',
        flexWrap: 'wrap',
        padding: '5px',
    },
    white: {
        color: '#ffffff'
    },
    wordwrap: {
        wordWrap: 'break-word'
    },
    cardContent: {
        width: '100%',
        alignItems: 'left',
        justifyContent: 'left',
        //textAlign: 'left'
    },
    wide: {
        width: '100%',
    },

    fabProgress: {
        position: 'absolute',
        zIndex: 1,
        left: '-7px',
        top: '-12px'
    },
    imageIcon: {
        position: 'relative',
        //left: '-7px',
        //top: '-5px'
    },
    vertical: {
        display: 'flex',
        flexDirection: 'column'
    },
    verticalAndWide: {
        display: 'flex',
        flexDirection: 'column',
        width: '100%'
    },
    horizontal: {
        display: 'flex',
        flexDirection: 'row',
        alignItems: 'center',
        justifyContent: 'center'
    },
    progressContainer: {
        //display: 'flex',
        //position: 'inherit'
        position: 'absolute',
        top: '-20px', right: '-100px'
    },
    progress: {
        //margin: theme.spacing(2),
        //position: 'absolute',
        //top: '-7px',
        //right: '78px',
    },
    progressText: {
        position: 'relative',
        fontSize: '0.7rem',
        wordBreak: 'break-word',
        width: '110px',
        top: '-30px',
    }
});

class Gallery extends Component {

    constructor(props) {
        super(props);

        this.state = {
            tiles: [],
            open: false, listView: true,
            parser: new MetadataParser(),
            master: props.master,
            allMetadata: [], localDownloads: []
        };

        this.syncWithPhotos();

        this.state.master.emitter.on('torrentReady', item => {
            this.addMediaToDom(item);
        }, this);

        const emitter = this.state.master.emitter;
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
                        self.state.master.torrentAddition.seed(duplicated.file, undefined, duplicated.file, () => {
                            Logger.info('seeded duplicate');
                        });
                    }
                });
            }*/
        }, this);

        emitter.on('downloadProgress', event => {
            const progress = event.progress;
            //const show = (progress > 0 && progress < 100);
            self.setState({torrent: event.torrent, progress: progress, downSpeed: event.speed});
        }, this);
        emitter.on('uploadProgress', event => {
            const progress = event.progress;
            //const show = (progress > 0 && progress < 100);
            self.setState({torrent: event.torrent, progress: progress, upSpeed: event.speed});
        }, this);

        emitter.on('galleryListView', isList => {

            self.setState({listView: isList});
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
        newTile.fileSize = FileUtil.formatBytes(newTile.elem.size);
        newTile.isVideo = newTile.elem.type.includes('video');
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

            this.state.master.emitter.emit('torrentDone', newTile.torrent);
            await this.state.master.service.updateOwner(newTile.infoHash, {
                peerId: this.state.master.client.peerId,
                loading: false
            });
            Logger.info('owner downloaded ' + newTile.torrent.name);
            /*this.state.master.emitter.emit('appEventRequest', {level: 'success', type: 'downloaded',
                event: {file: item.torrent.name, sharedBy: item.sharedBy, downloader: this.state.master.client.peerId}
            });*/
        }
    }

    syncWithPhotos() {
        this.state.master.emitter.on('photos', event => {

            const oldTiles = this.state.tiles;

            if(event.type === 'all') {

                ((oldTiles, photos) => {

                    photos.forEach(item => {
                        item.loading = true;
                    });

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
                        tiles.sort((a, b) => {
                            const dateA = moment(a.picDateTaken, format).toDate();
                            const dateB = moment(b.picDateTaken, format).toDate();
                            return dateB - dateA;
                        });
                        this.setState({tiles: tiles});
                    }
                })(oldTiles);

            } else if(event.type === 'delete') {

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

    handleOpen(tile) {

        this.setState((state, props) => ({
            open: true,
            tile: tile,
            allMetadata: this.state.parser.createMetadataSummary(tile.allMetadata)
        }));
    }

    handleClose() {
        this.setState({ open: false });
    }

    downloadFromServer(tile) {
        Logger.info('downloadFromServer ' + tile.fileName);
        download(tile.elem, tile.fileName);
        const localDownloads = update(this.state.localDownloads, {$push: [tile.infoHash]});
        this.setState({localDownloads: localDownloads});
    }

    addServerPeer(tile, action) {

        Logger.info(tile.torrent.magnetURI);

        const self = this;
        this.state.master.service.addServerPeer(tile.torrent.magnetURI).then(result => {

            self.state.master.emitter.emit('appEventRequest', {level: 'warning', type: 'serverPeer',
                event: {action: action, sharedBy: tile.sharedBy}
            });
            Logger.info('Shared server peer ' + result.url);

        }).catch(err => {

            Logger.warn('addServerPeer already added? ' + err);

            self.props.enqueueSnackbar('Image already shared with photogroup.network', {
                variant: 'error',
                autoHideDuration: 6000,
                action: <Button className={self.props.classes.white} size="small">x</Button>
            });
        });
    }

    async handleDelete(tile) {
        const infoHash = await this.state.master.torrentDeletion.deleteItem(tile.torrent);
        Logger.info('handleDelete ' + tile.torrent.name + ' ' + infoHash + ' ' + tile.torrent.infoHash);
    }

    handleImageLoaded(tile, img) {
        const parser = this.state.parser;
        parser.view = this;
        parser.readMetadata(tile, img, async tile => {

            if(tile.seed) {

                const photo = {
                    infoHash: tile.torrent.infoHash,
                    url: tile.torrent.magnetURI,
                    peerId: tile.peerId,
                    fileSize: tile.fileSize,
                    fileName: tile.fileName,
                    //metadata
                    picDateTaken: tile.picDateTaken,
                    picTitle: tile.picTitle,
                    picDesc: tile.picDesc,
                    picSummary: tile.picSummary,
                    cameraSettings: tile.cameraSettings,
                };

                await this.state.master.service.share(photo);
                //console.log('shared ' + shared);
                //await this.state.master.findExistingContent(this.state.master.service.find);
            }
        });
    }

    handleContainerLoaded(tile, node, file) {
        if(!tile || !file) {
            return;
        }

        if(!node) {
            return;
        }

        if(node.hasChildNodes()) {
            const tileInfoHash = tile.torrent.infoHash;
            const nodeInfoHash = node.infoHash;
            if(tileInfoHash !== nodeInfoHash) {
                this.removeFile(node);
                node.infoHash = tile.torrent.infoHash;
                this.appendFile(tile, node, file);
            }
            return;
        }

        node.infoHash = tile.torrent.infoHash;
        this.appendFile(tile, node, file);
    }

    appendFile(tile, node, file) {
        const opts = {
            autoplay: true,
            muted: true, loop: true
        };
        const self = this;
        file.appendTo(node, opts, (err, elem) => {
            // file failed to download or display in the DOM
            if (err) {
                //Unsupported file type
                const msgNode = document.createElement("div");                 // Create a <li> node
                const msgNodeText = document.createTextNode(err);         // Create a text node
                msgNode.appendChild(msgNodeText);
                node.appendChild(msgNode);

                Logger.error('webtorrent.appendTo ' + err.message);
                const {enqueueSnackbar, closeSnackbar} = self.props;
                enqueueSnackbar(err.message, {
                    variant: 'error',
                    persist: false,
                    autoHideDuration: 4000,
                    action: (key) => (<Button className={self.props.classes.white} onClick={ () => closeSnackbar(key) } size="small">x</Button>),
                });
            }

            console.log('New DOM node with the content', elem);
            if(elem && elem.style) {
                elem.style.width = '100%';
                elem.style.height = '100%';
            }

            if(tile.isVideo) {
                if(elem)
                    elem.loop = true;
            }
            self.handleImageLoaded(tile, elem);
        });
    }

    removeFile(node) {
        while (node.firstChild) {
            node.removeChild(node.firstChild);
        }
    }

    decrypt(tile, password, index) {
        const file = tile.file;
        const elem = tile.elem;
        const torrent = tile.torrent;
        const scope = this;

        Encrypter.decryptPic(elem, password, (blob) => {
            //scope.view.state.tiles.splice(index, 1);
            const tiles = update(scope.view.state.tiles, {$splice: [[index, 1]]});
            scope.view.setState({
                tiles: tiles
            });
            scope.renderTo(file, blob, torrent, false);
        });
    }

    buildTile(tile, index, classes, master,
              torrent, downSpeed, upSpeed, progress, localDownloads, listView) {

        const name = `${tile.picSummary} ${tile.fileSize} ${tile.cameraSettings}`;
        let owners = tile.owners ? tile.owners : [];

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

            const have = owners.find(owner => owner.peerId === master.client.peerId && !owner.isLoading);
            const loadingText = tile.rendering ? 'Rendering' : 'Loading';
            const isLoading = !!(torrent && torrent.infoHash === tile.infoHash);

            return <Paper key={index} style={{
                    margin: '10px',
                    padding: '10px'
                }}>
                    <span style={{
                        position: 'relative',
                        textAlign: 'center',
                        marginRight: '10px'
                    }}>
                        {have ? <CheckIcon /> : <ImageIcon className={classes.imageIcon} />}
                        {!have && <CircularProgress
                            color="secondary"
                            size={36} className={classes.fabProgress} />}
                        <Typography variant="caption" className={classes.wordwrap}>
                            {loadingText}
                        </Typography>
                        {isLoading ? <div className={classes.progressContainer}>
                            <CircularProgress id="progressBar"
                                              className={classes.progress}
                                              variant="static"
                                              value={progress}
                            />
                            <div className={classes.vertical}>
                                <Typography className={classes.progressText}
                                            variant={"caption"}>{downSpeed}</Typography>
                                <Typography className={classes.progressText}
                                            variant={"caption"}>{upSpeed}</Typography>
                            </div>
                            </div> : ''}
                    </span>
                    <Divider variant="middle" />
                    <span style={{
                        position: 'relative',
                        textAlign: 'center',
                        marginRight: '10px'
                    }}>
                    <Typography variant="caption" className={classes.wordwrap}>
                            {tile.picSummary} {tile.fileSize} {tile.cameraSettings}
                        </Typography>
                    </span>
                    <Divider variant="middle" />
                    <OwnersList emitter={master.emitter}
                                tile={tile} owners={tile.owners} peers={master.peers} myPeerId={master.client.peerId}
                    />
                </Paper>

        } else {
            const {open} = this.state;

            return <div key={index}>
                <div className={classes.gridList}>

                    {/*<div className={classes.wide}
                         ref={ref => this.handleContainerLoaded(tile, ref, tile.torrent.files[0])}>

                    </div>*/}

                    <img id={'img' + index} src={tile.img} alt={tile.fileName}
                         className={classes.wide}
                         onLoad={this.handleImageLoaded.bind(this, tile, tile.elem)} />

                    {listView ? <Paper className={classes.toolbar}>

                        <div style={{width: '100%'}} className={classes.horizontal}>

                            <IconButton onClick={this.downloadFromServer.bind(this, tile)}>
                                <CloudDownloadIcon/>
                            </IconButton>
                            {localDownloads.includes(tile.infoHash) ? <Typography variant={"caption"}>Downloaded</Typography> : ''}
                            <IconButton onClick={this.handleOpen.bind(this, tile)} className={classes.icon}>
                                <InfoIcon />
                            </IconButton>
                            <Typography onClick={this.handleOpen.bind(this, tile)} className={classes.wordwrap}
                                        title={tile.picSummary}
                                        variant="caption">{name}
                            </Typography>
                            <IconButton onClick={this.handleDelete.bind(this, tile)}
                                        className={classes.icon}>
                                <DeleteIcon />
                            </IconButton>
                            {/*<IconButton onClick={this.addServerPeer.bind(this, tile, label)}>
                                <CloudUploadIcon/>
                            </IconButton>*/}
                        </div>
                        <div style={{width: '100%'}}>
                            {/*<Typography variant={"caption"}>first shared by {tile.peerId}</Typography>*/}
                            <OwnersList emitter={master.emitter}
                                tile={tile} owners={tile.owners} peers={master.peers} myPeerId={master.client.peerId}
                            />
                        </div>
                    </Paper> : ''}
                </div>
                <PhotoDetails metadata={this.state.allMetadata}
                              open={open}
                              tile={tile}
                              service={master.service}
                              handleClose={this.handleClose.bind(this)} />
            </div>
        }
    }

    render() {
        const classes = this.props.classes;
        const {tiles, master, torrent, downSpeed, upSpeed, progress, localDownloads, listView} = this.state;

        const hasImages = tiles.find(tile => !tile.isLoading && !tile.secure && tile.img);
        if(hasImages) {
            master.emitter.emit('galleryHasImages', true);
        } else {
            master.emitter.emit('galleryHasImages', false);
        }
        return (
            <div>
                <div>
                    {tiles.map((tile, index) => this.buildTile(tile, index, classes, master,
                        torrent, downSpeed, upSpeed, progress, localDownloads, listView))}
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