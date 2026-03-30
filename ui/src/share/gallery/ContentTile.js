import React, { useState, useEffect, useRef, useCallback } from 'react';
import Typography from "@mui/material/Typography";
import Paper from "@mui/material/Paper";
import Box from "@mui/material/Box";
import Stack from "@mui/material/Stack";
import OwnersList from "./OwnersList";
import IconButton from "@mui/material/IconButton";
import CloudDownloadRounded from "@mui/icons-material/CloudDownloadRounded";
import DeleteRounded from "@mui/icons-material/DeleteRounded";
import InfoOutlined from "@mui/icons-material/InfoOutlined";
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

function ContentTile(props) {
    const {master, tile, enqueueSnackbar, closeSnackbar} = props;

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
    const [hovered, setHovered] = useState(false);

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
            setProgress(event.progress);
            setDownSpeed(event.speed);
            setTimeRemaining(event.timeRemaining);
        }
    }, [tile.infoHash]);

    const handleUploadProgress = useCallback((event) => {
        const torrent = event.torrent;
        if(torrent.infoHash === tile.infoHash) {
            setProgress(event.progress);
            setUpSpeed(event.speed);
            setTimeRemaining(event.timeRemaining);
        }
    }, [tile.infoHash]);

    const handleDone = useCallback(() => {
        setProgress(100);
    }, []);

    const handleTorrentReady = useCallback(() => {
        listenToPreview();
    }, []);

    const listenToPreview = useCallback(() => {
        if(tile.torrentFileThumb && tile.isAudio && typeof tile.torrentFileThumb.getBlobURL === 'function') {
            tile.torrentFileThumb.getBlobURL((err, url) => {
                if(err) {
                    Logger.error('preview ' + err);
                }
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

        attachTorrentListener(tile);
        listenToPreview();

        return () => {
            emitter.removeListener('galleryListView', handleGalleryListView);
            emitter.removeListener('disconnectNode', handleDisconnectNode);
            emitter.removeListener('downloadProgress', handleDownloadProgress);
            emitter.removeListener('uploadProgress', handleUploadProgress);
            emitter.removeListener('torrentReady', handleTorrentReady);

            if(tile.torrent && torrentListenerAttachedRef.current) {
                tile.torrent.removeListener('done', handleDone);
                torrentListenerAttachedRef.current = false;
            }
        };
    }, [master.emitter, handleGalleryListView, handleDisconnectNode, handleDownloadProgress, handleUploadProgress, handleTorrentReady, attachTorrentListener, tile, listenToPreview, handleDone]);

    useEffect(() => {
        if(tile.torrent && !torrentListenerAttachedRef.current) {
            attachTorrentListener(tile);
        }
    }, [tile.torrent, attachTorrentListener]);

    const handleOpen = useCallback(() => {
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
            action: (key) => (
                <Button onClick={() => closeSnackbar(key)} size="small" sx={{ color: '#fff' }}>
                    x
                </Button>
            ),
            anchorOrigin: {
                vertical: vertical,
                horizontal: 'right'
            }
        });
    }, [enqueueSnackbar, closeSnackbar]);

    const decrypt = useCallback(async (tile, password) => {
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

    const isLoading = tile.torrentFile && !tile.torrentFile.done;
    let progressPercentage, downloaded;
    if(isLoading && tile.torrentFile) {
        progressPercentage = Math.round(tile.torrentFile.progress * 100);
        downloaded = FileUtil.formatBytes(tile.torrentFile.downloaded);
    }

    const isDownloadingFile = localDownloading.includes(tile.infoHash);
    const downloadedFile = localDownloaded.includes(tile.infoHash);

    // Encrypted content that needs decryption
    if(tile.secure && !tile.seed && !isDecrypted) {
        return (
            <Paper
                sx={{
                    p: 2,
                    borderRadius: 2,
                    bgcolor: 'background.paper',
                }}
            >
                <Typography variant="body2" sx={{ mb: 1.5 }}>
                    Decrypt with
                </Typography>
                <Stack direction="row" spacing={1} alignItems="center">
                    <PasswordInput onChange={value => setPassword(value)} />
                    <Button
                        onClick={() => decrypt(tile, password)}
                        color="primary"
                        size="small"
                        variant="contained"
                    >
                        Submit
                    </Button>
                    <IconButton onClick={() => handleDelete(tile)} size="small">
                        <DeleteRounded fontSize="small" />
                    </IconButton>
                </Stack>
            </Paper>
        );
    }

    return (
        <Paper
            onMouseEnter={() => setHovered(true)}
            onMouseLeave={() => setHovered(false)}
            sx={{
                position: 'relative',
                borderRadius: 2,
                overflow: 'hidden',
                bgcolor: 'background.paper',
                transition: 'transform 0.2s ease, box-shadow 0.2s ease',
                '&:hover': {
                    transform: 'translateY(-2px)',
                    boxShadow: (t) =>
                        t.palette.mode === 'dark'
                            ? '0 8px 32px rgba(0,229,255,0.08)'
                            : '0 8px 32px rgba(0,0,0,0.12)',
                },
            }}
        >
            {/* Media content */}
            <Box sx={{ position: 'relative' }}>
                <RenderContent tile={tile} master={master} />

                {/* Hover overlay with action buttons */}
                <Box
                    sx={{
                        position: 'absolute',
                        inset: 0,
                        display: 'flex',
                        alignItems: 'flex-end',
                        justifyContent: 'center',
                        background: 'linear-gradient(to top, rgba(0,0,0,0.7) 0%, transparent 60%)',
                        opacity: hovered ? 1 : 0,
                        transition: 'opacity 0.2s ease',
                        pointerEvents: hovered ? 'auto' : 'none',
                        pb: 1,
                    }}
                >
                    <Stack direction="row" spacing={0.5}>
                        <IconButton
                            size="small"
                            disabled={isDownloadingFile}
                            onClick={() => downloadFromServer(tile)}
                            sx={{ color: '#fff' }}
                        >
                            <CloudDownloadRounded fontSize="small" />
                        </IconButton>
                        <IconButton
                            size="small"
                            onClick={handleOpen}
                            sx={{ color: '#fff' }}
                        >
                            <InfoOutlined fontSize="small" />
                        </IconButton>
                        <IconButton
                            size="small"
                            onClick={() => handleDelete(tile)}
                            sx={{ color: '#fff' }}
                        >
                            <DeleteRounded fontSize="small" />
                        </IconButton>
                    </Stack>
                </Box>
            </Box>

            {/* Audio preview thumbnail */}
            {previewThumbnail && (
                <Box sx={{ width: '100%' }}>
                    <img
                        src={previewThumbnail}
                        alt={'Preview ' + tile.fileName}
                        style={{ width: '100%', display: 'block' }}
                    />
                </Box>
            )}

            {/* Metadata strip */}
            <Collapse in={listView}>
                <Box sx={{ px: 1.5, py: 1 }}>
                    {/* File info row */}
                    <Stack direction="row" alignItems="center" spacing={1} sx={{ minHeight: 28 }}>
                        {/* Loading progress inline */}
                        {isLoading && (
                            <Stack direction="row" alignItems="center" spacing={0.5} sx={{ flexShrink: 0 }}>
                                <Typography
                                    variant="caption"
                                    sx={{
                                        fontFamily: 'var(--font-mono)',
                                        fontSize: '0.65rem',
                                        color: 'primary.main',
                                    }}
                                >
                                    {progressPercentage}%
                                </Typography>
                                <Typography
                                    variant="caption"
                                    sx={{
                                        fontFamily: 'var(--font-mono)',
                                        fontSize: '0.65rem',
                                        color: 'text.secondary',
                                    }}
                                >
                                    {downloaded}
                                </Typography>
                            </Stack>
                        )}

                        {/* File name / metadata */}
                        <Typography
                            variant="caption"
                            onClick={tile.hasMetadata ? handleOpen : undefined}
                            sx={{
                                flex: 1,
                                wordBreak: 'break-word',
                                color: tile.hasMetadata ? 'primary.main' : 'text.secondary',
                                cursor: tile.hasMetadata ? 'pointer' : 'default',
                                fontSize: '0.7rem',
                                lineHeight: 1.3,
                                '&:hover': tile.hasMetadata ? { textDecoration: 'underline' } : {},
                            }}
                            title={tile.picSummary}
                        >
                            {name}
                        </Typography>

                        {downloadedFile && (
                            <Typography
                                variant="caption"
                                sx={{
                                    color: 'success.main',
                                    fontSize: '0.65rem',
                                    fontFamily: 'var(--font-mono)',
                                    flexShrink: 0,
                                }}
                            >
                                Downloaded
                            </Typography>
                        )}
                    </Stack>

                    {/* Pieces loading view */}
                    <PiecesLoadingView master={master} tile={tile} />

                    {/* Owners list */}
                    <OwnersList
                        emitter={master.emitter}
                        tile={tile}
                        peers={master.peers}
                        myPeerId={master.client.peerId}
                    />
                </Box>

                <PhotoDetails
                    open={open}
                    tile={tile}
                    master={master}
                    parser={master.metadata}
                    handleClose={handleClose}
                />
            </Collapse>
        </Paper>
    );
}

export default withSnackbar(ContentTile);
