import React, { useState, useEffect, useCallback } from 'react';
import Typography from "@mui/material/Typography";
import Paper from "@mui/material/Paper";
import Box from "@mui/material/Box";
import Stack from "@mui/material/Stack";
import _ from 'lodash';

import CheckRounded from "@mui/icons-material/CheckRounded";
import CircularProgress from "@mui/material/CircularProgress";
import OwnersList from "./OwnersList";
import FileUtil from "../util/FileUtil";
import StringUtil from "../util/StringUtil";
import IconButton from "@mui/material/IconButton";
import DeleteRounded from "@mui/icons-material/DeleteRounded";
import Logger from "js-logger";
import PiecesLoadingView from "../torrent/PiecesLoadingView";

function LoadingTile({tile, master, name}) {
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
                setProgress(event.progress);
                setDownSpeed(event.speed);
                setTimeRemaining(event.timeRemaining);
            }
        };

        const handleUploadProgress = (event) => {
            const torrent = event.torrent;
            if(torrent.infoHash === tile.infoHash) {
                setProgress(event.progress);
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
            const infoHash = tile?.infoHash || tile?.file?.name || 'unknown';
            master.emitter.emit('photos', {
                type: 'delete', item: infoHash
            });
        }
    }, [master]);

    let displayName = name;
    const currentProgress = tile.torrentFile ? Math.round(tile.torrentFile.progress * 100) : progress;
    const progressPercentage = currentProgress ? Math.round(currentProgress) : null;
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
        <Paper
            sx={{
                borderRadius: 2,
                overflow: 'hidden',
                bgcolor: 'background.paper',
                position: 'relative',
                animation: 'pulse 2s ease-in-out infinite',
                border: '1px solid',
                borderColor: hasError ? 'error.main' : 'divider',
            }}
        >
            {/* Preview thumbnail with blur overlay */}
            {displayPreviewThumbnail ? (
                <Box sx={{ position: 'relative' }}>
                    <img
                        src={displayPreviewThumbnail}
                        alt={'Preview ' + tile.fileName}
                        style={{
                            width: '100%',
                            display: 'block',
                            filter: 'blur(2px) brightness(0.7)',
                        }}
                    />
                    {/* Progress overlay on thumbnail */}
                    {!have && (
                        <Box
                            sx={{
                                position: 'absolute',
                                inset: 0,
                                display: 'flex',
                                alignItems: 'center',
                                justifyContent: 'center',
                            }}
                        >
                            <Box sx={{ position: 'relative', display: 'inline-flex' }}>
                                <CircularProgress
                                    variant={isLoading ? 'determinate' : 'indeterminate'}
                                    value={currentProgress || 0}
                                    size={56}
                                    thickness={3}
                                    sx={{ color: 'primary.main' }}
                                />
                                {isLoading && (
                                    <Box
                                        sx={{
                                            position: 'absolute',
                                            inset: 0,
                                            display: 'flex',
                                            alignItems: 'center',
                                            justifyContent: 'center',
                                        }}
                                    >
                                        <Typography
                                            variant="caption"
                                            sx={{
                                                fontFamily: 'var(--font-mono)',
                                                fontSize: '0.7rem',
                                                color: '#fff',
                                                fontWeight: 700,
                                            }}
                                        >
                                            {progressPercentage}%
                                        </Typography>
                                    </Box>
                                )}
                            </Box>
                        </Box>
                    )}
                </Box>
            ) : null}

            {/* Content area */}
            <Box sx={{ p: 1.5 }}>
                {/* Status row */}
                <Stack direction="row" alignItems="center" spacing={1}>
                    {/* Status icon */}
                    {have ? (
                        <CheckRounded sx={{ color: 'success.main', fontSize: 20 }} />
                    ) : !displayPreviewThumbnail ? (
                        <Box sx={{ position: 'relative', display: 'inline-flex', flexShrink: 0 }}>
                            <CircularProgress
                                variant={isLoading ? 'determinate' : 'indeterminate'}
                                value={currentProgress || 0}
                                size={32}
                                thickness={3}
                                sx={{ color: hasError ? 'error.main' : 'primary.main' }}
                            />
                            {isLoading && (
                                <Box
                                    sx={{
                                        position: 'absolute',
                                        inset: 0,
                                        display: 'flex',
                                        alignItems: 'center',
                                        justifyContent: 'center',
                                    }}
                                >
                                    <Typography
                                        variant="caption"
                                        sx={{
                                            fontFamily: 'var(--font-mono)',
                                            fontSize: '0.55rem',
                                            fontWeight: 700,
                                        }}
                                    >
                                        {progressPercentage}%
                                    </Typography>
                                </Box>
                            )}
                        </Box>
                    ) : null}

                    {/* Status text + speeds */}
                    <Box sx={{ flex: 1, minWidth: 0 }}>
                        <Typography
                            variant="caption"
                            sx={{
                                color: hasError ? 'error.main' : 'text.secondary',
                                fontFamily: 'var(--font-mono)',
                                fontSize: '0.7rem',
                                display: 'block',
                            }}
                        >
                            {loadingText}
                            {hasError && tile.uploadError ? ': ' + tile.uploadError : ''}
                        </Typography>

                        {/* Speed info */}
                        {isLoading && (
                            <Stack direction="row" spacing={1} sx={{ mt: 0.25 }}>
                                {downSpeed && (
                                    <Typography
                                        variant="caption"
                                        sx={{
                                            fontFamily: 'var(--font-mono)',
                                            fontSize: '0.6rem',
                                            color: 'success.main',
                                        }}
                                    >
                                        {downSpeed}
                                    </Typography>
                                )}
                                {upSpeed && (
                                    <Typography
                                        variant="caption"
                                        sx={{
                                            fontFamily: 'var(--font-mono)',
                                            fontSize: '0.6rem',
                                            color: 'info.main',
                                        }}
                                    >
                                        {upSpeed}
                                    </Typography>
                                )}
                                {timeRemaining && (
                                    <Typography
                                        variant="caption"
                                        sx={{
                                            fontFamily: 'var(--font-mono)',
                                            fontSize: '0.6rem',
                                            color: 'text.disabled',
                                        }}
                                    >
                                        {timeRemaining}
                                    </Typography>
                                )}
                            </Stack>
                        )}
                    </Box>

                    {/* Delete button */}
                    <IconButton
                        onClick={() => handleDelete(tile)}
                        size="small"
                        sx={{ flexShrink: 0 }}
                    >
                        <DeleteRounded fontSize="small" />
                    </IconButton>
                </Stack>

                {/* File name */}
                {displayName && (
                    <Typography
                        variant="caption"
                        sx={{
                            display: 'block',
                            mt: 1,
                            wordBreak: 'break-word',
                            color: 'text.secondary',
                            fontSize: '0.7rem',
                            lineHeight: 1.3,
                        }}
                    >
                        {displayName}
                    </Typography>
                )}

                {/* Pieces heatmap */}
                <Box sx={{ mt: 0.5 }}>
                    <PiecesLoadingView master={master} tile={tile} />
                </Box>

                {/* Owners */}
                {!isRendering && (
                    <OwnersList
                        emitter={master.emitter}
                        tile={tile}
                        peers={master.peers}
                        myPeerId={master.client.peerId}
                    />
                )}
            </Box>

            {/* Bottom progress bar */}
            {isLoading && (
                <Box
                    sx={{
                        position: 'absolute',
                        bottom: 0,
                        left: 0,
                        right: 0,
                        height: 3,
                        bgcolor: 'action.hover',
                    }}
                >
                    <Box
                        sx={{
                            height: '100%',
                            width: `${currentProgress || 0}%`,
                            bgcolor: 'primary.main',
                            transition: 'width 0.3s ease',
                            boxShadow: (t) =>
                                t.palette.mode === 'dark'
                                    ? '0 0 8px rgba(0,229,255,0.5)'
                                    : 'none',
                        }}
                    />
                </Box>
            )}
        </Paper>
    );
}

export default LoadingTile;
