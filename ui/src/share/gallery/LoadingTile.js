import React, { useState, useEffect, useCallback } from 'react';
import {withStyles} from '@mui/styles';
import Typography from "@mui/material/Typography";
import Paper from "@mui/material/Paper";
import _ from 'lodash';

import CheckIcon from "@mui/icons-material/CheckRounded";
import ImageIcon from "@mui/icons-material/ImageRounded";
import CircularProgress from "@mui/material/CircularProgress";
import Divider from "@mui/material/Divider";
import OwnersList from "./OwnersList";
import FileUtil from "../util/FileUtil";
import StringUtil from "../util/StringUtil";
import IconButton from "@mui/material/IconButton";
import DeleteIcon from "@mui/icons-material/Delete";
import Logger from "js-logger";
import PiecesLoadingView from "../torrent/PiecesLoadingView";

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
    imageIcon: {
        position: 'relative',
        left: '-10px', top: '-10px'
    },
    progressPercentageText: {
        position: 'relative',
        fontSize: '0.7rem',
        bottom: '26px',
    },
    progressSpeedText: {
        fontSize: '0.7rem',
        wordBreak: 'break-word',
    },
    fabProgress: {
        position: 'absolute',
        zIndex: 1,
        left: '-17px',
        top: '-16px'
    },
    wide: {
        width: '100%',
    },
});

function LoadingTile({tile, master, classes, name}) {
    const [progress, setProgress] = useState(null);
    const [timeRemaining, setTimeRemaining] = useState('');
    const [downSpeed, setDownSpeed] = useState('');
    const [upSpeed, setUpSpeed] = useState('');
    const [previewThumbnail, setPreviewThumbnail] = useState(null);

    const listenToPreview = useCallback(() => {
        if(tile.loading && tile.torrentFileThumb && typeof tile.torrentFileThumb.getBlobURL === 'function') {
            tile.torrentFileThumb.getBlobURL((err, url) => {
                if(err) {
                    Logger.error('preview ' + err);
                } else {
                    setPreviewThumbnail(url);
                }
            });
        }
    }, [tile]);

    useEffect(() => {
        const emitter = master.emitter;

        const handleDownloadProgress = (event) => {
            const torrent = event.torrent;
            if(torrent.infoHash === tile.infoHash) {
                const progressValue = event.progress;
                setProgress(progressValue);
                setDownSpeed(event.speed);
                setTimeRemaining(event.timeRemaining);
            }
        };

        const handleUploadProgress = (event) => {
            const torrent = event.torrent;
            if(torrent.infoHash === tile.infoHash) {
                const progressValue = event.progress;
                setProgress(progressValue);
                setUpSpeed(event.speed);
                setTimeRemaining(event.timeRemaining);
            }
        };

        emitter.on('downloadProgress', handleDownloadProgress);
        emitter.on('uploadProgress', handleUploadProgress);
        emitter.on('torrentReady', listenToPreview);

        listenToPreview();

        return () => {
            emitter.removeListener('downloadProgress', handleDownloadProgress);
            emitter.removeListener('uploadProgress', handleUploadProgress);
            emitter.removeListener('torrentReady', listenToPreview);
        };
    }, [master.emitter, tile.infoHash, listenToPreview]);

    const handleDelete = useCallback(async (tile) => {
        try {
            // If tile doesn't have infoHash, just remove from UI
            if(!tile || !tile.infoHash) {
                Logger.warn('Cannot delete tile: missing infoHash, removing from UI only');
                master.emitter.emit('photos', {
                    type: 'delete', item: tile?.infoHash || tile?.file?.name || 'unknown'
                });
                return;
            }
            
            const result = await master.torrentDeletion.deleteItem(tile);
            Logger.info('handleDelete ' + result);
        } catch(err) {
            Logger.error('Failed to delete: ' + err);
            // Even if deletion fails, remove from UI
            const infoHash = tile?.infoHash || tile?.file?.name || 'unknown';
            master.emitter.emit('photos', {
                type: 'delete', item: infoHash
            });
        }
    }, [master]);

    let displayName = name;
    const currentProgress = tile.torrentFile ? Math.round(tile.torrentFile.progress * 100) : progress;
    const progressPercentage = currentProgress ? Math.round(currentProgress) + '%' : currentProgress;
    let have = tile.owners?.find(owner => owner.peerId === master.client.peerId && !owner.loading);
    const isLoading = !!currentProgress;
    let loadingText = tile.uploadError ? 'Upload Failed' : (tile.rendering && !isLoading ? 'Rendering' : (isLoading ? 'Loading' : 'Find Network Path'));
    const isRendering = loadingText === 'Rendering';
    const hasError = !!tile.uploadError;
    
    if(tile.rendering && !displayName) {
        const fileSize = _.get(tile, 'file.size');
        if(fileSize && !tile.fileSize) {
            tile.fileSize = FileUtil.formatBytes(fileSize);
        }
        displayName = StringUtil.addEmptySpaces([_.get(tile, 'file.name'), tile.fileSize, tile.picDateTaken]);
    }

    if(isRendering && tile.fromCache) {
        loadingText = 'Restoring from Cache';
        have = false;
    }

    let displayPreviewThumbnail = previewThumbnail;
    if(isRendering && tile.thumbnailFiles) {
        const thumbFile = tile.thumbnailFiles.find(item => 'Thumbnail ' + tile.fileName === item.name);
        if(thumbFile) {
            displayPreviewThumbnail = URL.createObjectURL(thumbFile);
        }
    }

    return (
        <Paper style={{
            margin: '10px',
            padding: '10px'
        }}>
            {displayPreviewThumbnail ? (
                <span>
                    <img src={displayPreviewThumbnail} alt={'Preview ' + tile.fileName}
                         className={classes.wide}/>
                </span>
            ) : null}

            <span className={classes.horizontal}>
                <span className={classes.horizontal} style={{
                    position: 'relative', 
                    textAlign: 'center',
                }}>
                    {have ? (
                        <CheckIcon style={{marginTop: '-14px'}} />
                    ) : (
                        <ImageIcon className={classes.imageIcon} />
                    )}
                    {!have && (
                        <CircularProgress
                            color="secondary"
                            size={36} 
                            className={classes.fabProgress} 
                        />
                    )}
                </span>
                <Typography variant="caption" className={classes.wordwrap} style={{
                    marginTop: '-14px',
                    color: hasError ? '#d32f2f' : 'inherit'
                }}>
                    {loadingText}
                    {hasError && tile.uploadError ? ': ' + tile.uploadError : ''}
                </Typography>
                {isLoading ? (
                    <span className={classes.horizontal} style={{marginLeft: '10px'}}>
                        <span className={classes.vertical}>
                            <span className={classes.vertical}>
                                <CircularProgress 
                                    style={{width: '35px', height: '35px'}}
                                    variant="determinate"
                                    value={currentProgress}
                                />
                                <Typography className={classes.progressPercentageText} variant={"caption"}>
                                    {progressPercentage}
                                </Typography>
                            </span>
                        </span>
                        <div className={classes.vertical} style={{ width: '80px', marginTop: '-14px'}}>
                            <Typography className={classes.progressSpeedText} variant={"caption"}>
                                {downSpeed}
                            </Typography>
                            <Typography className={classes.progressSpeedText} variant={"caption"}>
                                {upSpeed}
                            </Typography>
                        </div>
                        <div className={classes.vertical} style={{ width: '110px'}}>
                            <Typography className={classes.progressSpeedText} style={{marginTop: '-14px'}} variant={"caption"}>
                                {timeRemaining}
                            </Typography>
                        </div>
                    </span>
                ) : null}
                <IconButton 
                    onClick={() => handleDelete(tile)}
                    style={{marginTop: '-14px'}}
                >
                    <DeleteIcon />
                </IconButton>
            </span>
            <Divider variant="middle" />
            <span style={{
                position: 'relative',
                textAlign: 'center',
                marginRight: '10px'
            }}>
                <Typography variant="caption" className={classes.wordwrap}>
                    {displayName}
                </Typography>
            </span>
            <Divider variant="middle" />
            <div style={{width: '100%', height: '100%'}}>
                <PiecesLoadingView master={master} tile={tile} />
            </div>
            <Divider variant="middle" />
            {!isRendering ? (
                <OwnersList 
                    emitter={master.emitter}
                    tile={tile} 
                    peers={master.peers} 
                    myPeerId={master.client.peerId}
                />
            ) : null}
        </Paper>
    );
}

export default withStyles(styles)(LoadingTile);