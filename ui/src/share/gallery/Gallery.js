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
        this.model = props.model;
        this.model.view = this;
        this.state = {
            tileData: [],

            open: false,
            allMetadata: [],
            sharedBy: {},
            fileSize: '',
        };

        const self = this;

        props.master.emitter.on('networkTopology', data => {

            if(!props.master.client) return;

            const allEdges = data.edges;
            const allNodes = data.nodes;

            const allNats = allNodes
                .filter(item => item.networkType === 'nat');
            const otherPeers = data.nodes
                .filter(item => item.networkType === 'client'
                    && item.peerId !== props.master.client.peerId)
                .filter(item => {
                    if(item.originPlatform === 'photogroup.network'
                        && item.network && item.network.type !== 'host')
                        return false;
                    else
                        return true;
                });

            const uniqueOtherPeers = _.uniqBy(otherPeers, 'peerId');
            this.setState({
                allNats: allNats,
                allEdges: allEdges,
                otherPeers: uniqueOtherPeers
            });
        });

        props.master.emitter.on('addedTorrent', item => {

            const tile = {
                loading: true,
                item: item,
                torrent: {
                    infoHash: item.hash
                }
            };
            const tiles = self.state.tileData;
            const newTiles = update(tiles, {$unshift: [tile]});
            this.setState({
                tileData: newTiles
            });
        });

        props.master.emitter.on('deletedTorrent', hash => {

            const oldTiles = self.state.tileData;
            const index = oldTiles.findIndex(item => item.torrent.infoHash === hash);
            if(index > -1) {
                const tiles = update(oldTiles, {$splice: [[index, 1]]});
                this.setState({
                    tileData: tiles
                });
            }
        });

        props.master.emitter.on('urls', (urls, connections) => {

            const tiles = self.state.tileData;
            const changedTiles = [];

            tiles.forEach((tile, index) => {

                const url = urls.find(item => item.url === tile.torrent.magnetURI);

                if(url && url.fileName && tile.allMetadata) {
                    const allMetadata = self.model.parser.createMetadataSummary(tile.allMetadata);
                    const suffix = FileUtil.getFileSuffix(tile.torrent.name);
                    const fileName = FileUtil.truncateFileName(url.fileName);
                    const summary = self.model.parser.createSummary(allMetadata, tile.dateTaken, fileName + suffix);
                    const name = url.fileName;
                    if(summary !== tile.summary || name !== tile.name) {
                        tile.summary = summary;
                        tile.name = name;
                        changedTiles.push({
                            tile: tile,
                            index: index
                        });
                    }
                }
            });

            changedTiles.forEach(item => {

                this.setState({
                    urls: urls,
                    tileData: update(tiles, {[item.index]: {$set: item.tile}})
                });
            });

            const state = {
                urls: urls,
                connections: connections
            };

            /*if(wantedTiles && wantedTiles.length > 0) {
                const newTiles = update(tiles, {$unshift: wantedTiles});
                state.tileData = newTiles;
            }*/
            this.setState(state);
        });

        const { classes } = props;
        this.classes = classes;
    }

    handleOpen(tile) {

        this.setState((state, props) => ({
            open: true,
            url: props.master.urls.find(item => item.url === tile.torrent.magnetURI),
            allMetadata: props.model.parser.createMetadataSummary(tile.allMetadata),
            sharedBy: tile.sharedBy,
            fileSize: tile.size
        }));
    }

    handleClose() {
        this.setState({ open: false });
    }

    downloadFromServer(tile) {
        Logger.log('downloadFromServer ' + tile.name);
        const url = this.master.urls.find(item => item.url === tile.torrent.magnetURI);
        const name = url && url.fileName ? url.fileName + FileUtil.getFileSuffix(tile.name) : tile.name;
        download(tile.elem, name);
    }

    addServerPeer(tile, action) {

        Logger.log(tile.torrent.magnetURI);

        const self = this;
        this.master.service.addServerPeer(tile.torrent.magnetURI).then(result => {

            self.master.emitter.emit('appEventRequest', {level: 'warning', type: 'serverPeer',
                event: {action: action, sharedBy: tile.sharedBy}
            });
            Logger.log('Shared server peer ' + result.url);

        }).catch(err => {

            Logger.log('addServerPeer already added? ' + err);

            self.props.enqueueSnackbar('Image already shared with photogroup.network', {
                variant: 'error',
                autoHideDuration: 6000,
                action: <Button className={self.props.classes.white} size="small">x</Button>
            });
        });
    }

    async handleDelete(tile) {
        const hash = await this.model.deleteTile(tile);
        Logger.log('handleDelete ' + tile.torrent.name + ' ' + hash + ' ' + tile.torrent.infoHash);
    }

    handleImageLoaded(tile, img) {
        this.model.parser.readMetadata(tile, img, async tile => {

            if(tile.seed) {

                const url = {
                    hash: tile.torrent.infoHash,
                    url: tile.torrent.magnetURI,
                    secure: tile.secure,
                    peerId: tile.sharedBy.peerId,
                    fileSize: tile.size,
                    fileName: tile.fileName,
                    picDateTaken: tile.dateTaken,
                    picTitle: tile.title,
                    picDesc: tile.desc,
                    picSummary: tile.summary,
                    cameraSettings: tile.cameraSettings,
                };

                await this.master.service.share(url);
                //console.log('shared ' + shared);
                await this.master.findExistingContent(this.master.service.find);
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

    buildTile(tile, index, classes, connections, otherPeers, allNats, allEdges, urls) {

        const name = `${tile.summary} ${tile.size} ${tile.cameraSettings}`;
        let owners = [];
        if(tile.item) {
            owners = tile.item.owners;
        } else {
            const url = urls.find(item => item.hash === tile.torrent.infoHash);
            if(url) {
                owners = url.owners;
            }
        }
        if(tile.secure) {

            return <GridListTile key={index} cols={tile.cols || 1}>
                <div>Decrypt with</div>
                <PasswordInput onChange={value => this.setState({password: value})}/>
                <Button onClick={this.model.decrypt.bind(this.model, tile, this.state.password, index)}
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
                            {tile.item.picSummary} {tile.item.fileSize} {tile.item.cameraSettings}
                        </Typography>
                    </span>
                    <Divider variant="middle" />
                    <OwnersList
                        owners={owners}
                        connections={connections}
                        allEdges={allEdges}
                        allNats={allNats}
                        otherPeers={otherPeers}
                        item={tile.item}
                    />
                </Paper>

        } else {
            const {open, url} = this.state;

            return <div key={index}>
                <div cols={tile.cols || 1} className={classes.gridList}>

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
                                        title={tile.summary}
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
                            <Typography variant={"caption"}>first shared by {tile.sharedBy.originPlatform}</Typography>
                            <OwnersList
                                owners={owners}
                                connections={connections}
                                allEdges={allEdges}
                                allNats={allNats}
                                otherPeers={otherPeers}
                                item={tile.item}
                            />
                        </div>
                    </Paper>
                </div>
                <PhotoDetails metadata={this.state.allMetadata}
                              sharedBy={this.state.sharedBy}
                              fileSize={this.state.fileSize}
                              open={open}
                              url={url}
                              service={this.master.service}
                              handleClose={this.handleClose.bind(this)} />
            </div>
        }
    }

    render() {
        const classes = this.props.classes;
        const {tileData, connections, otherPeers, allNats, allEdges, urls} = this.state;

        return (
            <div className={classes.root}>

                <div className={classes.gridList}>
                    {tileData.map((tile, index) => this.buildTile(tile, index, classes,
                        connections, otherPeers, allNats, allEdges, urls))}
                </div>
            </div>
        );
    }
}

Gallery.propTypes = {
    classes: PropTypes.object.isRequired,
    model: PropTypes.object.isRequired,
    master: PropTypes.object.isRequired,
};
export default withSnackbar(withStyles(styles)(Gallery));