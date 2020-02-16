import React, { Component } from 'react';
import {withStyles} from '@material-ui/core/styles';
import Typography from "@material-ui/core/Typography";
import Paper from "@material-ui/core/Paper";
import OwnersList from "./OwnersList";
import IconButton from "@material-ui/core/IconButton";
import CloudDownloadIcon from "@material-ui/icons/CloudDownload";
import DeleteIcon from "@material-ui/icons/Delete";
import PhotoDetails from "./PhotoDetails";
import Logger from "js-logger";
import download from "downloadjs";
import update from "immutability-helper";
import Button from "@material-ui/core/Button/Button";
import { withSnackbar } from 'notistack';
import Collapse from '@material-ui/core/Collapse';
import Zoom from '@material-ui/core/Zoom';
import CircularProgress from "@material-ui/core/CircularProgress";
import FileUtil from "../util/FileUtil";

const styles = theme => ({
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
    wordwrap: {
        wordWrap: 'break-word'
    },
    wide: {
        width: '100%',
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
    progressPercentageText: {
        position: 'relative',
        fontSize: '0.7rem',
        //bottom: '26px',
    },
});

class ContentTile extends Component {

    constructor(props) {
        super(props);

        this.state = {
            open: false,
            listView: true,
            localDownloaded: [], localDownloading: [], there: true,
            //for streaming
            progress: null,
            downSpeed: '', upSpeed: '',
            timeRemaining: ''
        };
    }

    componentDidMount() {
        const {master, tile} = this.props;
        const emitter = master.emitter;

        emitter.on('galleryListView', this.handleGalleryListView, this);
        emitter.on('disconnectNode', this.handleDisconnectNode, this);
        emitter.on('downloadProgress', this.handleDownloadProgress, this);
        emitter.on('uploadProgress', this.handleUploadProgress, this);
        tile.torrent.on('done', this.handleDone.bind(this));
    }

    componentWillUnmount() {
        this.props.master.emitter.removeListener('galleryListView', this.handleGalleryListView, this);
        this.props.master.emitter.removeListener('disconnectNode', this.handleDisconnectNode, this);

        this.props.master.emitter.removeListener('downloadProgress', this.handleDownloadProgress, this);
        this.props.master.emitter.removeListener('uploadProgress', this.handleUploadProgress, this);
        this.props.tile.torrent.removeListener('done', this.handleDone, this);
    }

    handleGalleryListView(isList) {
        this.setState({listView: isList});
    }

    handleDisconnectNode(photo) {
        if(photo.infoHash === this.props.tile.infoHash) {
            this.setState({there: false});
        }
    }

    handleDownloadProgress(event) {
        const torrent = event.torrent;
        if(torrent.infoHash === this.props.tile.infoHash) {
            const progress = event.progress;
            this.setState({
                progress: progress,
                downSpeed: event.speed,
                timeRemaining: event.timeRemaining});
        }
    }

    handleUploadProgress(event) {
        const torrent = event.torrent;
        if(torrent.infoHash === this.props.tile.infoHash) {
            const progress = event.progress;
            this.setState({
                progress: progress,
                upSpeed: event.speed,
                timeRemaining: event.timeRemaining});
        }
    }

    handleDone() {
        this.setState({
            progress: 100
        })
    }

    /*addServerPeer(tile, action) {

        Logger.info(tile.torrent.magnetURI);

        const self = this;
        this.props.master.service.addServerPeer(tile.torrent.magnetURI).then(result => {

            self.props.master.emitter.emit('appEventRequest', {level: 'warning', type: 'serverPeer',
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
    }*/

    handleOpen(tile) {

        this.setState((state, props) => ({
            open: true,
            tile: tile
        }));
    }

    handleClose() {
        this.setState({ open: false });
    }

    downloadFromServer(tile) {
        Logger.info('downloadFromServer ' + tile.fileName);

        if(tile.elem) {

            this._download(tile.infoHash, tile.elem, tile.fileName);

        } else {

            this.setState(state => {
                const localDownloading = update(state.localDownloading, {$push: [tile.infoHash]});
                return {localDownloading: localDownloading};
            });

            tile.torrentFile.getBlob((err, elem) => {

                this.setState(state => {
                    const index = state.localDownloading.findIndex(item => item === tile.infoHash);
                    const localDownloading = update(state.localDownloading, {$splice: [[index, 1]]});
                    return {localDownloading: localDownloading};
                });

                if (err) {
                    Logger.error(err.message);
                } else {
                    this._download(tile.infoHash, elem, tile.fileName);
                }
            });
        }
    }

    _download(infoHash, elem, fileName) {
        download(elem, fileName);

        this.setState(state => {
            const localDownloaded = update(state.localDownloaded, {$push: [infoHash]});
            return {localDownloaded: localDownloaded};
        });
    }

    async handleDelete(tile) {
        this.setState({there: false});
        const infoHash = await this.props.master.torrentDeletion.deleteItem(tile);
        Logger.info('handleDelete ' + tile.torrent.name + ' ' + infoHash + ' ' + tile.torrent.infoHash);
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
            //autoplay: true,
            muted: false, loop: true,
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

            Logger.info('New DOM node with the content', elem);
            if(elem && elem.style) {
                elem.style.width = '100%';
                //elem.style.height = '100%';
            }

            if(tile.isVideo) {
                if(elem) {
                    //elem.preload = 'none';
                    //elem.autoplay = true;
                    elem.loop = true;
                    //elem.play();
                }
            }
        });
    }

    removeFile(node) {
        while (node.firstChild) {
            node.removeChild(node.firstChild);
        }
    }

    render() {

        const {tile, name, master, classes} = this.props;
        const {open, localDownloaded, localDownloading, listView, there, progress} = this.state;

        const isLoading = !tile.torrentFile.done;
        let loadingDom, progressPercentage, downloaded;
        if(isLoading) {
            progressPercentage = Math.round(tile.torrentFile.progress * 100);
            downloaded = FileUtil.formatBytes(tile.torrentFile.downloaded);
            loadingDom = <span className={classes.vertical} style={{width: '50px'}}>
                            <Typography className={classes.progressPercentageText}
                                        variant={"caption"}>{progressPercentage}%</Typography>
                            <Typography className={classes.progressPercentageText}
                                        style={{marginTop: '-5px'}}
                                        variant={"caption"}>{downloaded}</Typography>
                        </span>;
        }

        const renderMediaDom = tile.isImage
            ? <img src={tile.img} alt={tile.fileName}
                   className={classes.wide} />
            : <div style={{
                width: '100%',
            }}
                   ref={ref => this.handleContainerLoaded(tile, ref, tile.torrentFile)}>
            </div>;

        const isDownloadingFile = localDownloading.includes(tile.infoHash);
        const downloadedFile = localDownloaded.includes(tile.infoHash);

        return (
            /*<Zoom in={there}>*/
            <div className={classes.gridList}>

                {renderMediaDom}

                <Collapse in={listView}>
                    <Paper className={classes.toolbar}>
                    <div className={classes.horizontal} style={{width: '100%'}}>

                        {loadingDom}

                        <IconButton disabled={isDownloadingFile} onClick={this.downloadFromServer.bind(this, tile)}>
                            <CloudDownloadIcon/>
                        </IconButton>
                        {downloadedFile ? <Typography variant={"caption"}
                                                  style={{marginRight: '5px'}}>Downloaded</Typography> : ''}
                        {/*<IconButton onClick={this.handleOpen.bind(this, tile)}>
                            <InfoIcon />
                        </IconButton>*/}
                        <Typography onClick={this.handleOpen.bind(this, tile)} className={classes.wordwrap}
                                    title={tile.picSummary}
                                    variant="caption">{name}
                        </Typography>
                        <IconButton onClick={this.handleDelete.bind(this, tile)}>
                            <DeleteIcon />
                        </IconButton>
                        {/*<IconButton onClick={this.addServerPeer.bind(this, tile, label)}>
                            <CloudUploadIcon/>
                        </IconButton>*/}
                    </div>
                    <div style={{width: '100%'}}>
                        {/*<Typography variant={"caption"}>first shared by {tile.peerId}</Typography>*/}
                        <OwnersList emitter={master.emitter}
                                    tile={tile} peers={master.peers} myPeerId={master.client.peerId}
                        />
                    </div>
                    </Paper>
                    <PhotoDetails open={open}
                                  tile={tile}
                                  master={master}
                                  handleClose={this.handleClose.bind(this)} />
                </Collapse>
            </div>
            /*</Zoom>*/
        );
    }
}

export default withSnackbar(withStyles(styles)(ContentTile));