import React, { useEffect, useRef, useState, useCallback } from 'react';
import PropTypes from 'prop-types';
import Dialog from '@mui/material/Dialog';
import Box from '@mui/material/Box';
import Stack from '@mui/material/Stack';
import Typography from '@mui/material/Typography';
import Button from '@mui/material/Button';
import IconButton from '@mui/material/IconButton';
import CloseRounded from '@mui/icons-material/CloseRounded';
import ArrowBackRounded from '@mui/icons-material/ArrowBackRounded';
import ArrowForwardRounded from '@mui/icons-material/ArrowForwardRounded';
import CloudDownloadRounded from '@mui/icons-material/CloudDownloadRounded';
import SaveRounded from '@mui/icons-material/SaveRounded';
import IosShare from '@mui/icons-material/IosShare';
import InfoOutlined from '@mui/icons-material/InfoOutlined';
import useMediaQuery from '@mui/material/useMediaQuery';
import { useTheme } from '@mui/material/styles';
import _ from 'lodash';
import Logger from 'js-logger';
import FileUtil from '../util/FileUtil';
import OwnersList from './OwnersList';
import MediaMetadataPanel from './metadata/MediaMetadataPanel';
import RenderContent from './RenderContent';
import { saveLabel } from './savePhoto';
import { saveToDevice, savedWhereText } from './saveToDevice';
import { useSwipe } from './mediaView';
import { primePhotoCopy, replaceFailureMessage, replaceHint, replaceKind, replaceLabel, replaceOriginal } from './replaceOriginal';
import { canSaveDetails, saveDetails } from './metadata/saveDetails';
import { isPrivateRoom } from '../privateRoom';
import { canReadTorrentFile } from './saveRoom';

/**
 * Display the selected media full screen with navigation (swipe, arrows,
 * keys), saving, and shared metadata editing. The details sit beside the
 * photo on a wide screen and are hidden until asked for on a narrow one,
 * so the photo gets the room.
 */
function PhotoViewer({ master, tiles, index, onClose, onIndexChange }) {
    const theme = useTheme();
    const narrow = useMediaQuery(theme.breakpoints.down('md'));
    const [detailsAsked, setDetailsAsked] = useState(null);
    const showDetails = detailsAsked == null ? !narrow : detailsAsked;
    const tile = tiles[index];
    const [summary, setSummary] = useState(null);
    const [fileName, setFileName] = useState('');
    const [saving, setSaving] = useState(false);
    const [saved, setSaved] = useState(false);
    const [replacing, setReplacing] = useState(false);
    const [replaced, setReplaced] = useState(null);
    const [replaceError, setReplaceError] = useState('');

    const debouncedRename = useRef(
        _.throttle((infoHash, value) => {
            if (!value) return;
            Logger.info('change name ' + value);
            master.service.update([{
                infoHash,
                fileName: FileUtil.truncateFileName(value),
            }]);
        }, 1000, { leading: true, trailing: true })
    ).current;

    const handleSaveDetails = useCallback(
        (fields) => saveDetails(master, tile.infoHash, fields),
        [master, tile?.infoHash]);

    const handleFileNameChange = useCallback((value) => {
        setFileName(value);
        if (tile?.infoHash) {
            debouncedRename(tile.infoHash, value);
        }
    }, [tile?.infoHash, debouncedRename]);

    const applyMetadataSummary = useCallback((sourceTile) => {
        if (!sourceTile || !master.metadata || typeof master.metadata.createMetadataSummary !== 'function') {
            setSummary(null);
            return;
        }
        if (sourceTile.metadata) {
            setSummary(master.metadata.createMetadataSummary(sourceTile.metadata, sourceTile) || null);
        } else {
            setSummary(null);
        }
    }, [master.metadata]);

    useEffect(() => {
        if (tile) primePhotoCopy(tile);
    }, [tile, tile && tile.elem, tile && tile.file]);

    useEffect(() => {
        if (!tile) return;
        setFileName(FileUtil.getFileNameWithoutSuffix(tile.fileName) || '');
        setSaved(false);
        setSaving(false);
        setReplaced(null);
        setReplaceError('');
        applyMetadataSummary(tile);
    }, [tile, tile && tile.metadata, tile && tile.fileName, applyMetadataSummary]);

    useEffect(() => {
        if (!tile?.infoHash) return undefined;

        const handlePhotos = (event) => {
            if (event.type !== 'update' || !Array.isArray(event.item)) return;
            const updated = event.item.find(item => item.infoHash === tile.infoHash);
            if (updated) {
                applyMetadataSummary(updated);
            }
        };

        master.emitter.on('photos', handlePhotos);
        return () => master.emitter.removeListener('photos', handlePhotos);
    }, [tile?.infoHash, master.emitter, applyMetadataSummary]);

    useEffect(() => {
        const onKey = (event) => {
            const tag = event.target && event.target.tagName;
            if (tag === 'INPUT' || tag === 'TEXTAREA') return;
            if (event.key === 'ArrowRight' && index < tiles.length - 1) {
                onIndexChange(index + 1);
            } else if (event.key === 'ArrowLeft' && index > 0) {
                onIndexChange(index - 1);
            }
        };
        window.addEventListener('keydown', onKey);
        return () => window.removeEventListener('keydown', onKey);
    }, [index, tiles.length, onIndexChange]);

    const swipe = useSwipe(step => {
        const next = index + step;
        if (next >= 0 && next < tiles.length) onIndexChange(next);
    });

    if (!tile) return null;

    const isImage = !!tile.isImage;
    const canSave = !!(tile.elem || canReadTorrentFile(tile.torrentFile));
    const stillArriving = !!(tile.torrentFile && !tile.torrentFile.done);
    const replaceMode = replaceKind();
    const hint = replaceHint(tile);

    const onSave = () => {
        setSaving(true);
        saveToDevice([tile], { roomId: master.service && master.service.id })
            .then(result => setSaved(result !== 'cancelled'))
            .catch(() => {})
            .finally(() => setSaving(false));
    };

    const onReplace = () => {
        setReplacing(true);
        setReplaceError('');
        replaceOriginal(tile)
            .then(kind => setReplaced(kind))
            .catch(err => setReplaceError(replaceFailureMessage(err)))
            .finally(() => setReplacing(false));
    };

    const mediaPreview = isImage && tile.img ? (
        <img
            src={tile.img}
            alt={tile.fileName || 'Shared photo'}
            style={{
                width: '100%',
                height: '100%',
                objectFit: 'contain',
            }}
        />
    ) : (
        <Box sx={{ width: '100%', maxWidth: '100%', px: 1 }}>
            <RenderContent key={tile.infoHash} tile={tile} master={master} />
        </Box>
    );

    return (
        <Dialog
            open
            onClose={onClose}
            fullScreen
            aria-labelledby="photo-viewer-title"
            slotProps={{
                paper: {
                    sx: {
                        bgcolor: 'background.paper',
                        overflow: 'hidden',
                    },
                },
            }}
        >
            <Box sx={{
                display: 'flex',
                flexDirection: narrow ? 'column' : 'row',
                height: '100%',
                minHeight: 0,
            }}>
                <Box sx={{
                    flex: narrow && showDetails ? '0 0 62%' : 1,
                    minWidth: 0,
                    minHeight: 0,
                    display: 'flex',
                    flexDirection: 'column',
                    bgcolor: '#07090d',
                }}>
                    <Box sx={{ display: 'flex', alignItems: 'center', justifyContent: 'flex-end', gap: 0.5, p: 1 }}>
                        {tiles.length > 1 && (
                            <Typography variant="body2" sx={{ color: 'rgba(255,255,255,0.75)', mr: 'auto', pl: 1 }}>
                                {index + 1} of {tiles.length}
                            </Typography>
                        )}
                        <Button
                            size="small"
                            startIcon={<InfoOutlined fontSize="small" />}
                            aria-pressed={showDetails}
                            onClick={() => setDetailsAsked(!showDetails)}
                            sx={{ color: '#fff', textTransform: 'none' }}
                        >
                            {showDetails ? 'Hide details' : 'Details'}
                        </Button>
                        <IconButton aria-label="Close photo" onClick={onClose} sx={{ color: '#fff' }}>
                            <CloseRounded />
                        </IconButton>
                    </Box>
                    <Box {...swipe} data-testid="viewer-media" sx={{
                        flex: 1,
                        minHeight: 0,
                        display: 'flex',
                        alignItems: 'center',
                        justifyContent: 'center',
                        px: narrow ? 0 : 2,
                        overflow: 'hidden',
                        touchAction: 'pan-y pinch-zoom',
                    }}>
                        {mediaPreview}
                    </Box>
                    <Stack spacing={1} sx={{ mx: 1.5, mb: 1.5 }}>
                        <Stack
                            direction="row"
                            spacing={1}
                            sx={{
                                alignItems: 'center',
                                p: 1,
                                borderRadius: 2,
                                bgcolor: 'rgba(255,255,255,0.04)',
                                border: '1px solid rgba(255,255,255,0.08)',
                            }}
                        >
                            <IconButton
                                aria-label="Previous photo"
                                onClick={() => onIndexChange(index - 1)}
                                disabled={index <= 0}
                                sx={{ color: '#fff' }}
                            >
                                <ArrowBackRounded />
                            </IconButton>
                            <Button
                                variant="contained"
                                color="primary"
                                startIcon={<CloudDownloadRounded />}
                                disabled={!canSave || saving || replacing || stillArriving}
                                onClick={onSave}
                                sx={{ flex: 1 }}
                            >
                                {saveLabel(tile.fileSize, saving, saved)}
                            </Button>
                            <IconButton
                                aria-label="Next photo"
                                onClick={() => onIndexChange(index + 1)}
                                disabled={index >= tiles.length - 1}
                                sx={{ color: '#fff' }}
                            >
                                <ArrowForwardRounded />
                            </IconButton>
                        </Stack>
                        {replaceMode && (
                            <Button
                                variant="outlined"
                                color="primary"
                                data-testid="replace-original"
                                startIcon={replaceMode === 'share' ? <IosShare /> : <SaveRounded />}
                                disabled={!canSave || replacing || saving || stillArriving}
                                onClick={onReplace}
                                sx={{
                                    color: '#e8eef6',
                                    borderColor: 'rgba(61,214,195,0.45)',
                                    bgcolor: 'rgba(61,214,195,0.08)',
                                }}
                            >
                                {replaceLabel(tile, { replacing, replaced })}
                            </Button>
                        )}
                        <Typography
                            variant="caption"
                            data-testid="saved-where"
                            sx={{ display: 'block', textAlign: 'center', color: 'rgba(232,238,246,0.72)', px: 1 }}
                        >
                            {savedWhereText(1)}
                        </Typography>
                        {(replaceError || hint) && replaceMode && (
                            <Typography
                                variant="caption"
                                data-testid="replace-hint"
                                sx={{
                                    display: 'block',
                                    textAlign: 'center',
                                    color: replaceError ? 'error.main' : 'rgba(232,238,246,0.72)',
                                    px: 1,
                                }}
                            >
                                {replaceError || hint}
                            </Typography>
                        )}
                    </Stack>
                </Box>

                {showDetails && <Box data-testid="viewer-details" sx={{
                    flex: 1,
                    maxWidth: narrow ? 'none' : 420,
                    overflow: 'auto',
                    p: 2.5,
                    minHeight: 0,
                }}>
                    {/* The catalog title/rating/description lead; the file is context. */}
                    <Typography
                        id="photo-viewer-title"
                        variant="body2"
                        sx={{ color: 'text.secondary', fontFamily: 'var(--font-mono)', fontSize: '0.75rem', wordBreak: 'break-word' }}
                    >
                        {tile.fileName}{tile.fileSize ? ` · ${tile.fileSize}` : ''}
                    </Typography>

                    {(tile.isVideo || tile.isAudio) && !tile.hasMetadata && !summary && (
                        <Typography variant="body2" sx={{ mt: 2, color: 'text.secondary' }}>
                            Reading file details…
                        </Typography>
                    )}

                    <MediaMetadataPanel
                        summary={summary}
                        tile={tile}
                        fileName={fileName}
                        onFileNameChange={isPrivateRoom() ? undefined : handleFileNameChange}
                        onSaveDetails={canSaveDetails(master) ? handleSaveDetails : undefined}
                        myPeerId={master.client && master.client.peerId}
                    />

                    {Array.isArray(tile.owners) && master.peers && master.client
                        && tile.owners.some(owner => owner.peerId !== master.client.peerId) && (
                        <Box sx={{ mt: 2 }}>
                            <OwnersList
                                emitter={master.emitter}
                                tile={tile}
                                peers={master.peers}
                                myPeerId={master.client && master.client.peerId}
                            />
                        </Box>
                    )}
                </Box>}
            </Box>
        </Dialog>
    );
}

PhotoViewer.propTypes = {
    master: PropTypes.object.isRequired,
    tiles: PropTypes.array.isRequired,
    index: PropTypes.number.isRequired,
    onClose: PropTypes.func.isRequired,
    onIndexChange: PropTypes.func.isRequired,
};

export default PhotoViewer;
