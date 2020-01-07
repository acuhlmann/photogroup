import React, { Component } from 'react';
import PropTypes from 'prop-types';
import {withStyles} from '@material-ui/core/styles';

import GridListTile from '@material-ui/core/GridListTile';

import Button from "@material-ui/core/Button/Button";
import PasswordInput from "../security/PasswordInput";

import IconButton from '@material-ui/core/IconButton';
import InfoIcon from '@material-ui/icons/Info';
import DeleteIcon from '@material-ui/icons/Delete';
import CloudUploadIcon from '@material-ui/icons/CloudUpload';
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
//import OwnersList from "./OwnersList";

const styles = theme => ({
    root: {
        display: 'flex',
        flexWrap: 'wrap',
        justifyContent: 'space-around',
        width: '100%',
        backgroundColor: theme.palette.background.paper,
    },
    gridList: {
        width: '100%',
        paddingBottom: '10px'
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
    }
});

class Gallery extends Component {

    constructor(props) {
        super(props);

        this.master = props.master;
        this.parser = new MetadataParser();
        this.state = {
            tiles: [],
            open: false,
            allMetadata: []
        };

        this.syncWithPhotos();

        this.master.emitter.on('torrentReady', item => {
            this.addMediaToDom(item);
        }, this);

        const self = this;
        //When webtorrent errors on a duplicated add, try to remove and re-seed.
        //This may happen if client state is lost
        //i.e. due to removal of browser (indexeddb cache)
        this.master.emitter.on('duplicate', duplicated => {
            const tiles = this.state.tiles;
            const tile = tiles.find(item => item.infoHash === duplicated.torrentId);
            if(tile) {
                Logger.info('duplicate ' + tile.infoHash);
                duplicated.torrent.client.remove(duplicated.torrentId, () => {
                    if(duplicated.file) {
                        self.master.torrentAddition.seed(duplicated.file, undefined, duplicated.file, () => {
                            Logger.info('seeded duplicate');
                        });
                    }
                });
            }
        }, this);

        const { classes } = props;
        this.classes = classes;
    }

    addMediaToDom(item) {

        if(item.seed) {
            item.elem = item.file;
            this.renderTile(item);
        } else {
            item.torrentFile.getBlob((err, elem) => {
                if (err) {
                    Logger.error(err.message);
                } else {
                    item.elem = elem;
                    this.renderTile(item);
                }
            });
        }
    }

    renderTile(newTile) {
        newTile.fileSize = FileUtil.formatBytes(newTile.elem.size);
        newTile.isVideo = newTile.elem.type.includes('video');
        newTile.fileName = newTile.torrent.name;

        let tiles;
        const oldTiles = this.state.tiles;
        const index = oldTiles.findIndex(item => item.infoHash === newTile.infoHash);
        if(index > -1) {
            tiles = update(oldTiles, {$splice: [[index, 1, newTile]]});
        } else {
            tiles = update(oldTiles, {$unshift: [newTile]});
        }
        this.setState({tiles: tiles});

        if(!newTile.seed) {

            this.master.emitter.emit('torrentDone', newTile.torrent);
            this.master.service.addOwner(newTile.infoHash, this.master.client.peerId).then(() => {
                Logger.info('added owner and downloaded ' + newTile.torrent.name);
                /*this.master.emitter.emit('appEventRequest', {level: 'success', type: 'downloaded',
                    event: {file: item.torrent.name, sharedBy: item.sharedBy, downloader: this.master.client.peerId}
                });*/
            });
        }
    }

    syncWithPhotos() {
        this.master.emitter.on('photos', event => {

            const oldTiles = this.state.tiles;
            let tiles = oldTiles;

            if(event.type === 'add') {

                const index = oldTiles.findIndex(item => item.infoHash === event.item.infoHash);
                if(index < 0) {

                    const tile = event.item;
                    //tile.infoHash = null;
                    tile.loading = true;
                    tiles = update(oldTiles, {$unshift: [tile]});
                    this.setState({tiles: tiles});
                }
            } else if(event.type === 'delete') {

                const index = oldTiles.findIndex(item => item.infoHash === event.item);
                if(index > -1) {
                    tiles = update(oldTiles, {$splice: [[index, 1]]});
                    this.setState({tiles: tiles});
                }
            } else if(event.type === 'update') {

                const index = oldTiles.findIndex(item => item.infoHash === event.item.peerId);
                if(index > -1) {
                    tiles = update(oldTiles, {$splice: [[index, 1, event.item]]});
                    this.setState({tiles: tiles});
                }
            }
        });
    }

    handleOpen(tile) {

        this.setState((state, props) => ({
            open: true,
            tile: tile,
            allMetadata: this.parser.createMetadataSummary(tile.allMetadata)
        }));
    }

    handleClose() {
        this.setState({ open: false });
    }

    downloadFromServer(tile) {
        Logger.info('downloadFromServer ' + tile.name);
        const url = this.master.urls.find(item => item.url === tile.torrent.magnetURI);
        const name = url && url.fileName ? url.fileName + FileUtil.getFileSuffix(tile.name) : tile.name;
        download(tile.elem, name);
    }

    addServerPeer(tile, action) {

        Logger.info(tile.torrent.magnetURI);

        const self = this;
        this.master.service.addServerPeer(tile.torrent.magnetURI).then(result => {

            self.master.emitter.emit('appEventRequest', {level: 'warning', type: 'serverPeer',
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
        //const infoHash = await this.master.torrentDeletion.deleteTorrent(tile.torrent);
        const infoHash = await this.master.torrentDeletion.deleteItem(tile.torrent);
        Logger.info('handleDelete ' + tile.torrent.name + ' ' + infoHash + ' ' + tile.torrent.infoHash);
    }

    handleImageLoaded(tile, img) {
        this.parser.view = this;
        this.parser.readMetadata(tile, img, async tile => {

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

                await this.master.service.share(photo);
                //console.log('shared ' + shared);
                //await this.master.findExistingContent(this.master.service.find);
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

    appendFile(tile, node) {
        const file = tile.torrent.files[0];
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

    buildTile(tile, index, classes) {

        const name = `${tile.picSummary} ${tile.fileSize} ${tile.cameraSettings}`;
        let owners = tile.owners ? tile.owners : [];
        /*if(tile.item) {
            owners = tile.item.owners;
        } else {
            const url = urls.find(item => item.infoHash === tile.torrent.infoHash);
            if(url) {
                owners = url.owners;
            }
        }*/
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
            const have = owners.find(owner => owner.peerId === this.master.client.peerId);
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
                            {tile.picSummary} {tile.fileSize} {tile.cameraSettings}
                        </Typography>
                    </span>
                    <Divider variant="middle" />
                    {/*<OwnersList
                        owners={owners}
                        master={this.master}
                        tile={tile}
                    />*/}
                </Paper>

        } else {
            const {open} = this.state;

            return <div key={index}>
                <div className={classes.gridList}>

                    <div className={classes.wide}
                         ref={ref => this.handleContainerLoaded(tile, ref, tile.torrent.files[0])}>

                    </div>

                    <Paper className={classes.toolbar}>

                        <div style={{width: '100%'}}>
                            <IconButton onClick={this.downloadFromServer.bind(this, tile)}>
                                <CloudDownloadIcon/>
                            </IconButton>
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
                        <div className={classes.cardContent}>
                            <Typography variant={"caption"}>first shared by {tile.peerId}</Typography>
                            {/*<OwnersList
                                owners={owners}
                                master={this.master}
                                tile={tile}
                            />*/}
                        </div>
                    </Paper>
                </div>
                <PhotoDetails metadata={this.state.allMetadata}
                              open={open}
                              tile={tile}
                              service={this.master.service}
                              handleClose={this.handleClose.bind(this)} />
            </div>
        }
    }

    render() {
        const classes = this.props.classes;
        const {tiles} = this.state;

        return (
            <div className={classes.root}>

                <div className={classes.gridList}>
                    {tiles.map((tile, index) => this.buildTile(tile, index, classes))}
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