import React, { useEffect, useState } from 'react';
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
import InfoOutlined from '@mui/icons-material/InfoOutlined';
import DeleteRounded from '@mui/icons-material/DeleteRounded';
import useMediaQuery from '@mui/material/useMediaQuery';
import { useTheme } from '@mui/material/styles';
import RenderContent from './RenderContent';
import PhotoDetails from './PhotoDetails';
import { photoCaption } from './photoCaption';
import { saveLabel } from './savePhoto';
import { saveToDevice, savedWhereText } from './saveToDevice';
import { useSwipe } from './mediaView';
import { previewUrlOf } from './tilePreview';
import { primePhotoCopy, replaceFailureMessage, replaceHint, replaceKind, replaceLabel, replaceOriginal } from './replaceOriginal';
import { canReadTorrentFile } from './saveRoom';
import { removeLabel } from './removeLabel';

/**
 * Display the selected media full screen with navigation (swipe, arrows,
 * keys), saving, and shared metadata editing. The details sit beside the
 * photo on a wide screen and are hidden until asked for on a narrow one,
 * so the photo gets the room. With `details={false}` (photographer mode,
 * where the list already shows them) the viewer is the photo alone, with a
 * one-line caption. With `onRemove`, a Remove button takes the photo out of
 * the room and closes the viewer; if `onRemove` resolves to false (it
 * failed), the viewer stays open so it can be tried again.
 */
function PhotoViewer({ master, tiles, roomTiles, index, onClose, onIndexChange, onRemove, details = true }) {
    const theme = useTheme();
    const narrow = useMediaQuery(theme.breakpoints.down('md'));
    const [detailsAsked, setDetailsAsked] = useState(null);
    const showDetails = details && (detailsAsked == null ? !narrow : detailsAsked);
    const tile = tiles[index];
    const [saving, setSaving] = useState(false);
    const [saved, setSaved] = useState(false);
    const [replacing, setReplacing] = useState(false);
    const [replaced, setReplaced] = useState(null);
    const [replaceError, setReplaceError] = useState('');

    useEffect(() => {
        if (tile) primePhotoCopy(tile);
    }, [tile, tile && tile.elem, tile && tile.file]);

    useEffect(() => {
        if (!tile) return;
        setSaved(false);
        setSaving(false);
        setReplaced(null);
        setReplaceError('');
    }, [tile]);

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

    // Decode the photos either side ahead of time, so a swipe shows the next one at once.
    // On the next swipe the ones not needed any more are let go, so quick
    // swipes never pile up decodes in front of the photo shown.
    useEffect(() => {
        const ahead = [tiles[index + 1], tiles[index - 1]]
            .filter(next => next && next.isImage && next.img && !next.loading)
            .map(next => {
                const img = new Image();
                img.decoding = 'async';
                img.src = next.img;
                if (typeof img.decode === 'function') img.decode().catch(() => {});
                return img;
            });
        return () => ahead.forEach(img => img.removeAttribute('src'));
    }, [tiles, index]);

    const swipe = useSwipe(step => {
        const next = index + step;
        if (next >= 0 && next < tiles.length) onIndexChange(next);
    });

    if (!tile) return null;

    const isImage = !!tile.isImage;
    const caption = details ? '' : photoCaption(tile, master);
    const canSave = !!(tile.elem || canReadTorrentFile(tile.torrentFile));
    const stillArriving = !!(tile.torrentFile && !tile.torrentFile.done);
    const replaceMode = replaceKind();
    const hint = replaceHint();

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

    const preview = isImage ? previewUrlOf(tile) : null;
    const mediaPreview = isImage && tile.img ? (
        <img
            key={tile.img}
            src={tile.img}
            alt={tile.fileName || 'Shared photo'}
            // Decoded on another thread; the small preview shows meanwhile,
            // so the viewer opens at once instead of on a blank screen.
            decoding="async"
            style={{
                width: '100%',
                height: '100%',
                objectFit: 'contain',
                ...(preview ? {
                    backgroundImage: `url(${preview})`,
                    backgroundSize: 'contain',
                    backgroundPosition: 'center',
                    backgroundRepeat: 'no-repeat',
                } : null),
            }}
            onLoad={event => {
                // The preview stays until the photo is ready to paint.
                const img = event.currentTarget;
                const done = () => { img.style.backgroundImage = 'none'; };
                // A failed decode keeps the preview, so the screen is never blank.
                if (typeof img.decode === 'function') img.decode().then(done, () => {});
                else done();
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
            // The title sits in the details panel; without it, name the dialog by the file.
            {...(showDetails
                ? { 'aria-labelledby': 'photo-viewer-title' }
                : { 'aria-label': tile.fileName || 'Photo viewer' })}
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
                        {details && <Button
                            size="small"
                            startIcon={<InfoOutlined fontSize="small" />}
                            aria-pressed={showDetails}
                            onClick={() => setDetailsAsked(!showDetails)}
                            sx={{ color: '#fff', textTransform: 'none' }}
                        >
                            {showDetails ? 'Hide details' : 'Details'}
                        </Button>}
                        {onRemove && (
                            <IconButton aria-label={removeLabel(tile)} onClick={() => Promise.resolve(onRemove(tile)).then(removed => { if (removed !== false) onClose(); })}
                                sx={{ color: '#fff' }}>
                                <DeleteRounded />
                            </IconButton>
                        )}
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
                    {!details && caption && (
                        <Typography variant="body2" data-testid="viewer-caption"
                            sx={{ color: 'rgba(232,238,246,0.85)', textAlign: 'center', px: 2, pt: 1, fontFamily: 'var(--font-mono)', fontSize: '0.8rem' }}>
                            {caption}
                        </Typography>
                    )}
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
                        <Typography
                            variant="caption"
                            data-testid="saved-where"
                            sx={{ display: 'block', textAlign: 'center', color: 'rgba(232,238,246,0.72)', px: 1 }}
                        >
                            {savedWhereText(1)}
                        </Typography>
                        {/* The one Save goes the phone's normal way. Picking a folder is a small extra. */}
                        {replaceMode && (
                            <Button
                                variant="text"
                                size="small"
                                data-testid="replace-original"
                                title={hint}
                                disabled={!canSave || replacing || saving || stillArriving}
                                onClick={onReplace}
                                sx={{ alignSelf: 'center', textTransform: 'none', color: 'rgba(232,238,246,0.85)' }}
                            >
                                {replaceLabel(tile, { replacing, replaced })}
                            </Button>
                        )}
                        {replaceError && (
                            <Typography
                                variant="caption"
                                data-testid="replace-hint"
                                sx={{ display: 'block', textAlign: 'center', color: 'error.main', px: 1 }}
                            >
                                {replaceError}
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
                    <PhotoDetails master={master} tile={tile} roomTiles={roomTiles || tiles} headingId="photo-viewer-title" />
                </Box>}
            </Box>
        </Dialog>
    );
}

PhotoViewer.propTypes = {
    master: PropTypes.object.isRequired,
    tiles: PropTypes.array.isRequired,
    roomTiles: PropTypes.array,
    index: PropTypes.number.isRequired,
    onClose: PropTypes.func.isRequired,
    onIndexChange: PropTypes.func.isRequired,
    onRemove: PropTypes.func,
    details: PropTypes.bool,
};

export default PhotoViewer;
