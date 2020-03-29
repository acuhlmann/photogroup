import React, { Component } from 'react';
import {withStyles} from '@material-ui/core/styles';
import Typography from "@material-ui/core/Typography";
import Paper from "@material-ui/core/Paper";
import OwnersList from "./OwnersList";
import IconButton from "@material-ui/core/IconButton";
import CloudDownloadIcon from "@material-ui/icons/CloudDownload";
import DeleteIcon from "@material-ui/icons/Delete";
import PhotoDetails from "./metadata/PhotoDetails";
import Logger from "js-logger";
import download from "downloadjs";
import update from "immutability-helper";
import Button from "@material-ui/core/Button/Button";
import { withSnackbar } from 'notistack';
import Collapse from '@material-ui/core/Collapse';
import FileUtil from "../util/FileUtil";
import PiecesLoadingView from "../torrent/PiecesLoadingView";
import PasswordInput from "../security/PasswordInput";
import WebCrypto from "../security/WebCrypto";
import RenderContent from "./RenderContent";

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
    moveUp: {
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
            timeRemaining: '',
            password: '', isDecrypted: false,
            previewThumbnail: null
        };
    }

    componentDidMount() {
        const {master, tile} = this.props;
        const emitter = master.emitter;

        emitter.on('galleryListView', this.handleGalleryListView, this);
        emitter.on('disconnectNode', this.handleDisconnectNode, this);
        emitter.on('downloadProgress', this.handleDownloadProgress, this);
        emitter.on('uploadProgress', this.handleUploadProgress, this);
        emitter.on('torrentReady', this.listenToPreview, this);
        tile.torrent.on('done', this.handleDone.bind(this));

        this.listenToPreview();
    }

    componentWillUnmount() {
        const emitter = this.props.master.emitter;
        emitter.removeListener('galleryListView', this.handleGalleryListView, this);
        emitter.removeListener('disconnectNode', this.handleDisconnectNode, this);

        emitter.removeListener('downloadProgress', this.handleDownloadProgress, this);
        emitter.removeListener('uploadProgress', this.handleUploadProgress, this);
        emitter.removeListener('torrentReady', this.listenToPreview, this);
        this.props.tile.torrent.removeListener('done', this.handleDone, this);
    }

    listenToPreview() {
        const {tile} = this.props;
        if(tile.torrentFileThumb && tile.isAudio) {
            const file = tile.torrentFileThumb;
            tile.torrentFileThumb.getBlobURL((err, url) => {
                if(err) {
                    Logger.error('preview ' + err);
                }
                console.log(file);
                this.setState({previewThumbnail: url});
            });
        }
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
        });
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

    snack(payload, type = 'info', persist = false, vertical = 'bottom') {

        const {enqueueSnackbar, closeSnackbar} = this.props;

        enqueueSnackbar(payload, {
            variant: type,
            persist: persist,
            autoHideDuration: 4000,
            action: (key) => (<Button className={this.props.classes.white} onClick={() => closeSnackbar(key)}
                                      size="small">x</Button>),
            anchorOrigin: {
                vertical: vertical,
                horizontal: 'right'
            }
        });
    }

    buildMetadataTitle(tile, name, classes) {
        if(tile.hasMetadata) {
            return <a href="#">
                <Typography onClick={this.handleOpen.bind(this, tile)} className={classes.wordwrap}
                            title={tile.picSummary}
                            variant="caption">{name}
                </Typography>
            </a>
        } else {
            return <Typography onClick={this.handleOpen.bind(this, tile)} className={classes.wordwrap}
                               title={tile.picSummary}
                               variant="caption">{name}
            </Typography>
        }
    }

    async decrypt(tile, password, index) {
        const elem = tile.elem;
        const self = this;

        const crypto = new WebCrypto();
        let result;
        try {
            result = await crypto.decryptFile([elem], password, tile.fileName);
        } catch(e) {
            Logger.error('Error decrypting ' + e);
            self.snack('Cannot Decrypt', 'error', false, 'bottom');
            return;
        }

        tile.isDecrypted = true;

        const file = new File([result.blob], tile.fileName, { type: tile.fileType });
        tile.elem = file;
        tile.file = file;
        tile.img = URL.createObjectURL(file);

        this.setState({isDecrypted: true})
    }

    render() {

        const {tile, name, master, classes} = this.props;
        const {open, localDownloaded, localDownloading, listView,
            isDecrypted, previewThumbnail} = this.state;

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

        const isDownloadingFile = localDownloading.includes(tile.infoHash);
        const downloadedFile = localDownloaded.includes(tile.infoHash);

        return (
            <div className={classes.moveUp}>

                {tile.secure && !tile.seed && !isDecrypted ?
                    <div style={{
                        marginTop: '10px', marginBottom: '10px'
                    }}>
                        <Typography>Decrypt with</Typography>
                        <span className={classes.horizontal}>
                            <PasswordInput onChange={value => this.setState({password: value})}/>
                            <Button onClick={this.decrypt.bind(this, tile, this.state.password)}
                                    color="primary" style={{
                                    marginTop: '-30px'
                                }}>
                                Submit
                            </Button>
                            <IconButton onClick={this.handleDelete.bind(this, tile)}
                                        style={{
                                            marginTop: '-30px'
                                        }}>
                                <DeleteIcon />
                            </IconButton>
                        </span>
                    </div> : <span>
                        <RenderContent tile={tile} master={master} />
                        <Collapse in={listView}>
                            <Paper className={classes.toolbar}>

                                {previewThumbnail ? <span>
                                    <img src={previewThumbnail} alt={'Preview ' + tile.fileName}
                                         className={classes.wide}/>
                                </span> : ''}

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
                                    {this.buildMetadataTitle(tile, name, classes)}
                                    <IconButton onClick={this.handleDelete.bind(this, tile)}>
                                        <DeleteIcon />
                                    </IconButton>
                                    {/*<IconButton onClick={this.addServerPeer.bind(this, tile, label)}>
                                        <CloudUploadIcon/>
                                    </IconButton>*/}
                                </div>
                                <div style={{width: '100%'}}>
                                    <PiecesLoadingView master={master} tile={tile} />
                                </div>
                                <div style={{width: '100%', height: '100%'}}>
                                    <OwnersList emitter={master.emitter}
                                                tile={tile} peers={master.peers} myPeerId={master.client.peerId}
                                    />
                                </div>
                            </Paper>
                            <PhotoDetails open={open}
                                          tile={tile}
                                          master={master} parser={master.metadata}
                                          handleClose={this.handleClose.bind(this)} />
                        </Collapse>
                    </span>
                }
            </div>
        );
    }
}

export default withSnackbar(withStyles(styles)(ContentTile));