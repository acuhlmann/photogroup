import React, { useState, useEffect, useCallback, useMemo } from 'react';
import Typography from "@mui/material/Typography";
import Paper from "@mui/material/Paper";
import Box from "@mui/material/Box";
import Stack from "@mui/material/Stack";
import IconButton from "@mui/material/IconButton";
import CloudDownloadRounded from "@mui/icons-material/CloudDownloadRounded";
import DeleteRounded from "@mui/icons-material/DeleteRounded";
import Logger from "js-logger";
import update from "immutability-helper";
import Button from "@mui/material/Button";
import { withSnackbar } from '../compatibility/withSnackbar';
import FileUtil from "../util/FileUtil";
import PiecesLoadingView from "../torrent/PiecesLoadingView";
import PasswordInput from "../security/PasswordInput";
import WebCrypto from "../security/WebCrypto";
import RenderContent from "./RenderContent";
import { saveLabel, savePhoto } from "./savePhoto";
import { photoTransitionName } from "./viewTransition";
import { groupMetadataForDisplay } from "./metadata/groupPhotoMetadata";
import { RatingStars, ColorLabel, StarPicker } from "./metadata/MediaMetadataPanel";
import InlineTitle from "./metadata/InlineTitle";
import { LocationLine } from "./metadata/LocationCard";
import { canSaveDetails, saveDetails } from "./metadata/saveDetails";

/** Display loaded media and metadata highlights, with save, delete, and decryption controls. */
function ContentTile(props) {
    const {master, tile, enqueueSnackbar, closeSnackbar, onOpen, selected, hero} = props;

    const [localDownloaded, setLocalDownloaded] = useState([]);
    const [localDownloading, setLocalDownloading] = useState([]);
    const [there, setThere] = useState(true);
    const [downSpeed, setDownSpeed] = useState('');
    const [upSpeed, setUpSpeed] = useState('');
    const [timeRemaining, setTimeRemaining] = useState('');
    const [password, setPassword] = useState('');
    const [isDecrypted, setIsDecrypted] = useState(false);
    const [previewThumbnail, setPreviewThumbnail] = useState(null);

    const handleDisconnectNode = useCallback((photo) => {
        if(photo.infoHash === tile.infoHash) {
            setThere(false);
        }
    }, [tile.infoHash]);

    const handleDownloadProgress = useCallback((event) => {
        const torrent = event.torrent;
        if(torrent.infoHash === tile.infoHash) {
            setDownSpeed(event.speed);
            setTimeRemaining(event.timeRemaining);
        }
    }, [tile.infoHash]);

    const handleUploadProgress = useCallback((event) => {
        const torrent = event.torrent;
        if(torrent.infoHash === tile.infoHash) {
            setUpSpeed(event.speed);
            setTimeRemaining(event.timeRemaining);
        }
    }, [tile.infoHash]);

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

    const handleTorrentReady = useCallback(() => {
        listenToPreview();
    }, [listenToPreview]);

    useEffect(() => {
        const emitter = master.emitter;

        emitter.on('disconnectNode', handleDisconnectNode);
        emitter.on('downloadProgress', handleDownloadProgress);
        emitter.on('uploadProgress', handleUploadProgress);
        emitter.on('torrentReady', handleTorrentReady);

        listenToPreview();

        return () => {
            emitter.removeListener('disconnectNode', handleDisconnectNode);
            emitter.removeListener('downloadProgress', handleDownloadProgress);
            emitter.removeListener('uploadProgress', handleUploadProgress);
            emitter.removeListener('torrentReady', handleTorrentReady);
        };
    }, [master.emitter, handleDisconnectNode, handleDownloadProgress, handleUploadProgress, handleTorrentReady, listenToPreview]);

    const downloadFromServer = useCallback((tile) => {
        Logger.info('downloadFromServer ' + tile.fileName);
        setLocalDownloading(prev => update(prev, {$push: [tile.infoHash]}));
        savePhoto(tile)
            .then(() => {
                setLocalDownloaded(prev => update(prev, {$push: [tile.infoHash]}));
            })
            .catch(err => {
                Logger.error(err && err.message ? err.message : err);
            })
            .finally(() => {
                setLocalDownloading(prev => {
                    const index = prev.findIndex(item => item === tile.infoHash);
                    if (index < 0) return prev;
                    return update(prev, {$splice: [[index, 1]]});
                });
            });
    }, []);

    /** Hide the tile immediately; deletion failures reject without restoring it. */
    const handleDelete = useCallback(async (tile) => {
        setThere(false);
        const infoHash = await master.torrentDeletion.deleteItem(tile);
        Logger.info('handleDelete ' + (tile.torrent?.name || tile.fileName) + ' ' + infoHash);
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

    const grouped = useMemo(() => {
        // Shared details show even before this browser has read the file.
        const summary = tile.metadata && master.metadata
            ? master.metadata.createMetadataSummary(tile.metadata, tile) : null;
        return groupMetadataForDisplay(summary, tile);
    // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [tile.metadata, tile.details, master.metadata]);
    const { title, rating, description } = Object.fromEntries(grouped.highlights.map(item => [item.kind, item]));

    const canEdit = canSaveDetails(master);
    /** Save one shared field from the tile, telling the person when it fails. */
    const saveField = useCallback(async (fields) => {
        try {
            await saveDetails(master, tile.infoHash, fields);
        } catch (err) {
            snack(err && err.status === 404
                ? 'This photo is still being shared. Try again in a moment.'
                : (err && err.message) || 'Could not save. Try again.', 'error');
            throw err;
        }
    // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [master, tile.infoHash]);

    // A photo restored from cache is complete even while its torrent re-verifies.
    const isLoading = tile.torrentFile && !tile.torrentFile.done && !tile.elem;
    let progressPercentage, downloaded;
    if(isLoading && tile.torrentFile) {
        progressPercentage = Math.round(tile.torrentFile.progress * 100);
        downloaded = FileUtil.formatBytes(tile.torrentFile.downloaded);
    }

    const isDownloadingFile = localDownloading.includes(tile.infoHash);
    const downloadedFile = localDownloaded.includes(tile.infoHash);
    const canSave = !isLoading && (tile.elem || (tile.torrentFile && typeof tile.torrentFile.getBlob === 'function'));
    const transitionName = selected ? undefined : photoTransitionName(tile.infoHash);

    if (!there) {
        return null;
    }

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
                <Stack direction="row" spacing={1} sx={{ alignItems: 'center' }}>
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

    const arrival = [
        isLoading ? `${progressPercentage}%` : '',
        downloaded,
        downSpeed ? `↓ ${downSpeed}` : '',
        upSpeed ? `↑ ${upSpeed}` : '',
        timeRemaining,
    ].filter(Boolean).join(' · ');

    return (
        <Paper
            elevation={0}
            className="media-card"
            sx={{
                position: 'relative',
                borderRadius: 2,
                overflow: 'hidden',
                bgcolor: 'background.paper',
            }}
        >
            <Box
                component="button"
                type="button"
                aria-label={tile.fileName ? `View ${tile.fileName}` : 'View photo'}
                onClick={() => onOpen && onOpen()}
                sx={{
                    display: 'block',
                    width: '100%',
                    p: 0,
                    border: 0,
                    background: 'none',
                    cursor: 'pointer',
                    textAlign: 'left',
                    viewTransitionName: transitionName,
                    '& img': hero ? {
                        width: '100%',
                        height: 'auto',
                        maxHeight: 'min(72vh, 720px)',
                        objectFit: 'contain',
                    } : undefined,
                }}
            >
                {selected && (tile.isVideo || tile.isAudio) ? (
                    <Box
                        sx={{
                            minHeight: hero ? 280 : 160,
                            bgcolor: '#0a0c10',
                            display: 'flex',
                            alignItems: 'center',
                            justifyContent: 'center',
                            px: 2,
                        }}
                    >
                        <Typography variant="caption" sx={{ color: 'text.secondary', textAlign: 'center' }}>
                            Playing in full view
                        </Typography>
                    </Box>
                ) : (
                    <RenderContent tile={tile} master={master} />
                )}
            </Box>

            {previewThumbnail && (
                <Box sx={{ width: '100%' }}>
                    <img
                        src={previewThumbnail}
                        alt={'Preview ' + tile.fileName}
                        style={{ width: '100%', display: 'block' }}
                    />
                </Box>
            )}

            <Box sx={{ px: 1.5, py: 1.25 }}>
                {/* Title, rating and description lead when the file has them; the file name is context. */}
                <InlineTitle
                    value={title ? title.value : ''}
                    onSave={canEdit ? (value => saveField({ title: value })) : undefined}
                />
                {canEdit ? (
                    <Stack direction="row" spacing={1} sx={{ alignItems: 'center', mt: 0.25, ml: -0.25 }}>
                        <StarPicker
                            value={grouped.values.rating}
                            size={18}
                            showLabel={grouped.values.rating === -1}
                            onChange={stars => saveField({ rating: stars }).catch(() => {})}
                        />
                        {rating && <ColorLabel value={rating.colorLabel} />}
                    </Stack>
                ) : rating && (
                    <Stack direction="row" spacing={1} sx={{ alignItems: 'center', mt: 0.5 }}>
                        {rating.value === -1
                            ? <Typography variant="caption" sx={{ color: 'error.main', fontWeight: 600 }}>Rejected</Typography>
                            : rating.value != null && <RatingStars value={rating.value} size={16} />}
                        <ColorLabel value={rating.colorLabel} />
                    </Stack>
                )}
                {description && (
                    <Typography
                        variant="body2"
                        sx={{
                            mt: 0.5,
                            color: 'text.secondary',
                            lineHeight: 1.45,
                            wordBreak: 'break-word',
                            display: '-webkit-box',
                            WebkitLineClamp: 2,
                            WebkitBoxOrient: 'vertical',
                            overflow: 'hidden',
                        }}
                    >
                        {description.value}
                    </Typography>
                )}
                {grouped.location && <LocationLine location={grouped.location} />}
                <Typography
                    variant={title ? 'caption' : 'body2'}
                    sx={{
                        display: 'block',
                        wordBreak: 'break-word',
                        lineHeight: 1.3,
                        mt: title || rating || description ? 0.75 : 0,
                        ...(title ? { color: 'text.secondary', fontFamily: 'var(--font-mono)' } : {}),
                    }}
                    title={tile.fileName}
                >
                    {tile.fileName}
                    {title && tile.fileSize ? ` · ${tile.fileSize}` : ''}
                </Typography>
                {!title && tile.fileSize && (
                    <Typography variant="caption" sx={{ color: 'text.secondary', display: 'block', mt: 0.35, fontFamily: 'var(--font-mono)' }}>
                        {tile.fileSize}
                    </Typography>
                )}

                {arrival && (
                    <Typography
                        variant="caption"
                        sx={{
                            display: 'block',
                            mt: 0.5,
                            fontFamily: 'var(--font-mono)',
                            color: 'primary.main',
                        }}
                    >
                        {arrival}
                    </Typography>
                )}

                <Stack direction="row" spacing={1} sx={{ alignItems: 'center', mt: 1 }}>
                    <Button
                        variant="contained"
                        color="primary"
                        size="small"
                        startIcon={<CloudDownloadRounded />}
                        disabled={!canSave || isDownloadingFile}
                        onClick={() => downloadFromServer(tile)}
                    >
                        {saveLabel(tile.fileSize, isDownloadingFile, downloadedFile)}
                    </Button>
                    <IconButton
                        aria-label={`Remove ${tile.fileName || 'photo'}`}
                        onClick={() => handleDelete(tile)}
                        size="small"
                    >
                        <DeleteRounded fontSize="small" />
                    </IconButton>
                </Stack>

                <PiecesLoadingView master={master} tile={tile} />
            </Box>
        </Paper>
    );
}

export default withSnackbar(ContentTile);
