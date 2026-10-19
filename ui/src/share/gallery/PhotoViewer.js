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
import useMediaQuery from '@mui/material/useMediaQuery';
import { useTheme } from '@mui/material/styles';
import _ from 'lodash';
import Logger from 'js-logger';
import FileUtil from '../util/FileUtil';
import OwnersList from './OwnersList';
import MediaMetadataPanel from './metadata/MediaMetadataPanel';
import RenderContent from './RenderContent';
import { saveLabel, savePhoto } from './savePhoto';
import { photoTransitionName, supportsViewTransition } from './viewTransition';

function PhotoViewer({ master, tiles, index, onClose, onIndexChange }) {
    const theme = useTheme();
    const fullScreen = useMediaQuery(theme.breakpoints.down('md'));
    const tile = tiles[index];
    const [summary, setSummary] = useState(null);
    const [fileName, setFileName] = useState('');
    const [saving, setSaving] = useState(false);
    const [saved, setSaved] = useState(false);

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

    const handleSaveDetails = useCallback(async (fields) => {
        const saved = await master.service.updateDetails(tile.infoHash, fields);
        // The room hears it over SSE too; show it here without waiting.
        master.emitter.emit('photos', { type: 'update', item: [saved] });
    }, [master, tile?.infoHash]);

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
        if (!tile) return;
        setFileName(FileUtil.getFileNameWithoutSuffix(tile.fileName) || '');
        setSaved(false);
        setSaving(false);
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

    if (!tile) return null;

    const isImage = !!tile.isImage;
    const transitionName = photoTransitionName(tile.infoHash);
    const canSave = !!(tile.elem || (tile.torrentFile && typeof tile.torrentFile.getBlob === 'function'));
    const stillArriving = !!(tile.torrentFile && !tile.torrentFile.done);

    const onSave = () => {
        setSaving(true);
        savePhoto(tile)
            .then(() => setSaved(true))
            .catch(() => {})
            .finally(() => setSaving(false));
    };

    const mediaPreview = isImage && tile.img ? (
        <img
            src={tile.img}
            alt={tile.fileName || 'Shared photo'}
            style={{
                width: '100%',
                height: '100%',
                objectFit: 'contain',
                viewTransitionName: transitionName,
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
            fullScreen={fullScreen}
            maxWidth="lg"
            fullWidth
            aria-labelledby="photo-viewer-title"
            transitionDuration={supportsViewTransition() ? 0 : undefined}
            slotProps={{
                paper: {
                    sx: {
                        bgcolor: 'background.paper',
                        overflow: 'hidden',
                        height: fullScreen ? '100%' : 'min(90vh, 860px)',
                    },
                },
            }}
        >
            <Box sx={{
                display: 'flex',
                flexDirection: fullScreen ? 'column' : 'row',
                height: '100%',
                minHeight: 0,
            }}>
                <Box sx={{
                    flex: 1.4,
                    minWidth: 0,
                    minHeight: 0,
                    display: 'flex',
                    flexDirection: 'column',
                    bgcolor: '#07090d',
                }}>
                    <Box sx={{ display: 'flex', justifyContent: 'flex-end', p: 1 }}>
                        <IconButton aria-label="Close photo" onClick={onClose} sx={{ color: '#fff' }}>
                            <CloseRounded />
                        </IconButton>
                    </Box>
                    <Box sx={{
                        flex: 1,
                        minHeight: 0,
                        display: 'flex',
                        alignItems: 'center',
                        justifyContent: 'center',
                        px: 2,
                        overflow: 'hidden',
                    }}>
                        {mediaPreview}
                    </Box>
                    <Stack
                        direction="row"
                        spacing={1}
                        sx={{
                            alignItems: 'center',
                            mx: 1.5,
                            mb: 1.5,
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
                            disabled={!canSave || saving || stillArriving}
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
                </Box>

                <Box sx={{
                    flex: 1,
                    maxWidth: fullScreen ? 'none' : 420,
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
                        onFileNameChange={handleFileNameChange}
                        onSaveDetails={master.service && typeof master.service.updateDetails === 'function'
                            ? handleSaveDetails : undefined}
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
                </Box>
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
