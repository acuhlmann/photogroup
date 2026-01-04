import React, { useState, useEffect, useRef, useCallback } from 'react';
import {withStyles} from '@mui/styles';
import Typography from "@mui/material/Typography";
import Paper from "@mui/material/Paper";
import OwnersList from "./OwnersList";
import IconButton from "@mui/material/IconButton";
import CloudDownloadIcon from "@mui/icons-material/CloudDownload";
import DeleteIcon from "@mui/icons-material/Delete";
import PhotoDetails from "./metadata/PhotoDetails";
import Logger from "js-logger";
import download from "downloadjs";
import update from "immutability-helper";
import Button from "@mui/material/Button";
import { withSnackbar } from '../compatibility/withSnackbar';
import Collapse from '@mui/material/Collapse';
import FileUtil from "../util/FileUtil";
import PiecesLoadingView from "../torrent/PiecesLoadingView";
import PasswordInput from "../security/PasswordInput";
import WebCrypto from "../security/WebCrypto";
import RenderContent from "./RenderContent";
import StringUtil from "../util/StringUtil";
import _ from "lodash";

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

function ContentTile(props) {
    const {master, tile, classes, enqueueSnackbar, closeSnackbar} = props;

    const [open, setOpen] = useState(false);
    const [listView, setListView] = useState(true);
    const [localDownloaded, setLocalDownloaded] = useState([]);
    const [localDownloading, setLocalDownloading] = useState([]);
    const [there, setThere] = useState(true);
    const [progress, setProgress] = useState(null);
    const [downSpeed, setDownSpeed] = useState('');
    const [upSpeed, setUpSpeed] = useState('');
    const [timeRemaining, setTimeRemaining] = useState('');
    const [password, setPassword] = useState('');
    const [isDecrypted, setIsDecrypted] = useState(false);
    const [previewThumbnail, setPreviewThumbnail] = useState(null);
    
    // Track if we've attached the torrent listener to avoid duplicates
    const torrentListenerAttachedRef = useRef(false);

    const handleGalleryListView = useCallback((isList) => {
        setListView(isList);
    }, []);

    const handleDisconnectNode = useCallback((photo) => {
        if(photo.infoHash === tile.infoHash) {
            setThere(false);
        }
    }, [tile.infoHash]);

    const handleDownloadProgress = useCallback((event) => {
        const torrent = event.torrent;
        if(torrent.infoHash === tile.infoHash) {
            const progress = event.progress;
            setProgress(progress);
            setDownSpeed(event.speed);
            setTimeRemaining(event.timeRemaining);
        }
    }, [tile.infoHash]);

    const handleUploadProgress = useCallback((event) => {
        const torrent = event.torrent;
        if(torrent.infoHash === tile.infoHash) {
            const progress = event.progress;
            setProgress(progress);
            setUpSpeed(event.speed);
            setTimeRemaining(event.timeRemaining);
        }
    }, [tile.infoHash]);

    const handleDone = useCallback(() => {
        setProgress(100);
    }, []);

    const handleTorrentReady = useCallback((photos) => {
        // When torrentReady is emitted, the photos are updated via 'photos' event
        // which will cause a re-render. useEffect will handle attaching the listener.
        // We just need to call listenToPreview here
        listenToPreview();
    }, []);

    const listenToPreview = useCallback(() => {
        if(tile.torrentFileThumb && tile.isAudio && typeof tile.torrentFileThumb.getBlobURL === 'function') {
            const file = tile.torrentFileThumb;
            tile.torrentFileThumb.getBlobURL((err, url) => {
                if(err) {
                    Logger.error('preview ' + err);
                }
                console.log(file);
                setPreviewThumbnail(url);
            });
        }
    }, [tile.torrentFileThumb, tile.isAudio]);

    const attachTorrentListener = useCallback((tile) => {
        if(tile && tile.torrent && !torrentListenerAttachedRef.current) {
            tile.torrent.on('done', handleDone);
            torrentListenerAttachedRef.current = true;
        }
    }, [handleDone]);

    useEffect(() => {
        const emitter = master.emitter;

        emitter.on('galleryListView', handleGalleryListView);
        emitter.on('disconnectNode', handleDisconnectNode);
        emitter.on('downloadProgress', handleDownloadProgress);
        emitter.on('uploadProgress', handleUploadProgress);
        emitter.on('torrentReady', handleTorrentReady);
        
        // Only attach torrent listener if torrent exists
        attachTorrentListener(tile);

        listenToPreview();

        return () => {
            emitter.removeListener('galleryListView', handleGalleryListView);
            emitter.removeListener('disconnectNode', handleDisconnectNode);
            emitter.removeListener('downloadProgress', handleDownloadProgress);
            emitter.removeListener('uploadProgress', handleUploadProgress);
            emitter.removeListener('torrentReady', handleTorrentReady);
            
            // Only remove listener if torrent exists and we attached it
            if(tile.torrent && torrentListenerAttachedRef.current) {
                tile.torrent.removeListener('done', handleDone);
                torrentListenerAttachedRef.current = false;
            }
        };
    }, [master.emitter, handleGalleryListView, handleDisconnectNode, handleDownloadProgress, handleUploadProgress, handleTorrentReady, attachTorrentListener, tile, listenToPreview, handleDone]);

    useEffect(() => {
        // If torrent becomes available after mount, attach the listener
        if(tile.torrent && !torrentListenerAttachedRef.current) {
            attachTorrentListener(tile);
        }
    }, [tile.torrent, attachTorrentListener]);

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

    const handleOpen = useCallback((tile) => {
        setOpen(true);
    }, []);

    const handleClose = useCallback(() => {
        setOpen(false);
    }, []);

    const _download = useCallback((infoHash, elem, fileName) => {
        download(elem, fileName);

        setLocalDownloaded(prev => update(prev, {$push: [infoHash]}));
    }, []);

    const downloadFromServer = useCallback((tile) => {
        Logger.info('downloadFromServer ' + tile.fileName);

        if(tile.elem) {
            _download(tile.infoHash, tile.elem, tile.fileName);
        } else {
            setLocalDownloading(prev => update(prev, {$push: [tile.infoHash]}));

            tile.torrentFile.getBlob((err, elem) => {
                setLocalDownloading(prev => {
                    const index = prev.findIndex(item => item === tile.infoHash);
                    return update(prev, {$splice: [[index, 1]]});
                });

                if (err) {
                    Logger.error(err.message);
                } else {
                    _download(tile.infoHash, elem, tile.fileName);
                }
            });
        }
    }, [_download]);

    const handleDelete = useCallback(async (tile) => {
        setThere(false);
        const infoHash = await master.torrentDeletion.deleteItem(tile);
        Logger.info('handleDelete ' + tile.torrent.name + ' ' + infoHash + ' ' + tile.torrent.infoHash);
    }, [master.torrentDeletion]);

    const snack = useCallback((payload, type = 'info', persist = false, vertical = 'bottom') => {
        enqueueSnackbar(payload, {
            variant: type,
            persist: persist,
            autoHideDuration: 4000,
            action: (key) => (<Button className={classes.white} onClick={() => closeSnackbar(key)}
                                      size="small">x</Button>),
            anchorOrigin: {
                vertical: vertical,
                horizontal: 'right'
            }
        });
    }, [enqueueSnackbar, closeSnackbar, classes.white]);

    const buildMetadataTitle = useCallback((tile, name, classes) => {
        if(tile.hasMetadata) {
            return <a href="#">
                <Typography onClick={() => handleOpen(tile)} className={classes.wordwrap}
                            title={tile.picSummary}
                            variant="caption">{name}
                </Typography>
            </a>
        } else {
            return <Typography onClick={() => handleOpen(tile)} className={classes.wordwrap}
                               title={tile.picSummary}
                               variant="caption">{name}
            </Typography>
        }
    }, [handleOpen]);

    const decrypt = useCallback(async (tile, password, index) => {
        const elem = tile.elem;

        const crypto = new WebCrypto();
        let result;
        try {
            result = await crypto.decryptFile([elem], password, tile.fileName);
        } catch(e) {
            Logger.error('Error decrypting ' + e);
            snack('Cannot Decrypt', 'error', false, 'bottom');
            return;
        }

        tile.isDecrypted = true;

        const file = new File([result.blob], tile.fileName, { type: tile.fileType });
        tile.elem = file;
        tile.file = file;
        tile.img = URL.createObjectURL(file);

        setIsDecrypted(true);
    }, [snack]);

    let name = StringUtil.addEmptySpaces([
        tile.picSummary, tile.fileSize, tile.cameraSettings]) || props.name;

    // Safety check: ensure torrentFile exists before accessing its properties
    const isLoading = tile.torrentFile && !tile.torrentFile.done;
    let loadingDom, progressPercentage, downloaded;
    if(isLoading && tile.torrentFile) {
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
                        <PasswordInput onChange={value => setPassword(value)}/>
                        <Button onClick={() => decrypt(tile, password)}
                                color="primary" style={{
                                marginTop: '-30px'
                            }}>
                            Submit
                        </Button>
                        <IconButton onClick={() => handleDelete(tile)}
                                    style={{
                                        marginTop: '-30px'
                                    }}>
                            <DeleteIcon />
                        </IconButton>
                    </span>
                </div> : <span>
                    <RenderContent tile={tile} master={master} classes={classes} />
                    <Collapse in={listView}>
                        <Paper className={classes.toolbar}>

                            {previewThumbnail ? <img src={previewThumbnail} alt={'Preview ' + tile.fileName}
                                                     className={classes.wide}/> : ''}

                            <div className={classes.horizontal} style={{width: '100%'}}>

                                {loadingDom}

                                <IconButton disabled={isDownloadingFile} onClick={() => downloadFromServer(tile)}>
                                    <CloudDownloadIcon/>
                                </IconButton>
                                {downloadedFile ? <Typography variant={"caption"}
                                                          style={{marginRight: '5px'}}>Downloaded</Typography> : ''}
                                {/*<IconButton onClick={() => handleOpen(tile)}>
                                    <InfoIcon />
                                </IconButton>*/}
                                {buildMetadataTitle(tile, name, classes)}
                                <IconButton onClick={() => handleDelete(tile)}>
                                    <DeleteIcon />
                                </IconButton>
                                {/*<IconButton onClick={() => addServerPeer(tile, label)}>
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
                                      handleClose={handleClose} />
                    </Collapse>
                </span>
            }
        </div>
    );
}

export default withSnackbar(withStyles(styles)(ContentTile));