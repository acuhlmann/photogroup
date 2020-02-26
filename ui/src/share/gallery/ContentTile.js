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
import FileUtil from "../util/FileUtil";
import PiecesLoadingView from "../torrent/PiecesLoadingView";
import Webamp from 'webamp';
import {Icon} from "@material-ui/core";

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
    imageIcon: {
        height: '100%'
    },
    iconRoot: {
        textAlign: 'center'
    }
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
        if(!tile || !file || !node) {
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

    handleWebamp(tile, node, file) {
        if(!tile || !file || !node || !tile.isAudio) {
            return;
        }

        if(!Webamp.browserIsSupported()) {
            Logger.error("Oh no! Webamp does not work!")
            throw new Error("What's the point of anything?")
        }
        const webamp = new Webamp({
            initialTracks: [{
                metaData: {
                    artist: "DJ Mike Llama",
                    title: "Llama Whippin' Intro",
                },
                url: "llama-2.91.mp3"
            }],
            zIndex: 99999,
        });
        //this.setState({webamp: webamp, webampNode: node});
        this.webamp = webamp;
        this.webampNode = node;
        //webamp.renderWhenReady(node);
        //webamp.appendTracks([{blob: 'https://example.com/track1.mp3'}]);
    }

    openInWebamp() {
        const webamp = this.webamp;
        this.props.tile.torrentFile.getBlob((err, elem) => {
            webamp.appendTracks([{blob: elem}]);
            webamp.renderWhenReady(this.webampNode).then(() => {
                //webamp.appendTracks([{blob: 'https://example.com/track1.mp3'}]);
                webamp.play();
            });
        });
    }

    appendFile(tile, node, file) {
        const opts = {
            autoplay: !tile.isAudio,
            muted: !tile.isAudio, loop: true,
        };
        //if(tile.isAudio) opts.muted = false;


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

            this.getBlobAndReadMetadata(tile);

            if(tile.isVideo) {
                if(elem) {
                    //elem.preload = 'none';
                    //elem.autoplay = true;
                    elem.loop = true;
                    //elem.play();
                }
            }
        });
        Logger.info('streaming start ' + tile.torrentFile.progress);
        /*tile.torrent.critical(0, tile.torrent.pieces.length - 1);
        tile.torrent._rechoke();

        const stream = tile.torrentFile.createReadStream({
                                                    start: 0,
                                                    end: tile.torrent.pieces.length - 1
                                                });
        stream.on('data', (chunk) => {
            console.log(`Received ${chunk.length} bytes of data.`);
        });
        stream.on('end', () => {
            console.log('There will be no more data.');
        });*/
    }

    getBlobAndReadMetadata(tile) {
        Logger.info('streaming done ' + tile.torrentFile.progress);
        const master = this.props.master;
        /*master.metadata.readStreaming(tile, (tile, metadata) => {
            Logger.info('readStreaming');
        });*/

        tile.torrentFile.getBlob((err, elem) => {
            Logger.info('streaming getBlob ' + tile.torrentFile);
            if (err) {
                Logger.error(err.message);
            } else {
                tile.elem = elem;
                this.readMetadata(tile);
            }
        });
    }

    readMetadata(tile) {
        const master = this.props.master;
        master.metadata.readMetadata(tile, (tile, metadata) => {
            Logger.info('readMetadata');
            master.emitter.emit('photos', {type: 'update', item: [tile]});
            if(tile.seed) {
                master.emitter.emit('photoRendered', tile);
            }
        });
    }

    imgLoaded(tile) {
        this.readMetadata(tile);
    }

    removeFile(node) {
        while (node.firstChild) {
            node.removeChild(node.firstChild);
        }
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

    renderMediaDom(tile, classes) {
        return tile.isImage
            ? <img src={tile.img} alt={tile.fileName}
                   className={classes.wide}
                   onLoad={this.imgLoaded.bind(this, tile)} />
            : <div className={classes.horizontal}>
                {tile.isAudio ? <div className={classes.horizontal}>
                        <Typography variant={"caption"}>Open in</Typography>
                        <IconButton color="primary"
                                    onClick={() => this.openInWebamp()}>

                            <Icon classes={{root: classes.iconRoot}}>
                                <img className={classes.imageIcon} src="./webamp.svg"/>
                            </Icon>
                        </IconButton>
                    </div> : ''}
                    <div style={{
                    width: '100%', marginTop: '10px'}}
                       ref={ref => this.handleContainerLoaded(tile, ref, tile.torrentFile)}>
                    </div>
                {tile.isAudio ? <div ref={ref => this.handleWebamp(tile, ref, tile.torrentFile)}>
                    </div> : ''};
                </div>;
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

        const isDownloadingFile = localDownloading.includes(tile.infoHash);
        const downloadedFile = localDownloaded.includes(tile.infoHash);

        return (
            /*<Zoom in={there}>*/
            <div className={classes.gridList}>

                {this.renderMediaDom(tile, classes)}

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
            </div>
            /*</Zoom>*/
        );
    }
}

export default withSnackbar(withStyles(styles)(ContentTile));