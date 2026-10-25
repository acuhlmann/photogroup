import React, { useState, useEffect, useCallback } from 'react';
import PropTypes from 'prop-types';
import Box from '@mui/material/Box';
import Stack from '@mui/material/Stack';
import Button from '@mui/material/Button';
import ButtonBase from '@mui/material/ButtonBase';
import Typography from '@mui/material/Typography';
import CircularProgress from '@mui/material/CircularProgress';
import Dialog from '@mui/material/Dialog';
import IconButton from '@mui/material/IconButton';
import CheckRounded from '@mui/icons-material/CheckRounded';
import CloseRounded from '@mui/icons-material/CloseRounded';
import ArrowBackRounded from '@mui/icons-material/ArrowBackRounded';
import ArrowForwardRounded from '@mui/icons-material/ArrowForwardRounded';
import DownloadRounded from '@mui/icons-material/DownloadRounded';
import PlayCircleRounded from '@mui/icons-material/PlayCircleRounded';
import AudiotrackRounded from '@mui/icons-material/AudiotrackRounded';
import Logger from 'js-logger';

import { isReadyToSave } from '../gallery/saveRoom';
import { alreadyHave, useHaveChanges } from '../gallery/alreadyHave';
import { saveToDevice } from './saveToDevice';
import { loadPreviewUrl, previewUrlOf } from '../gallery/tilePreview';

/** A clip whose whole file is on this device, so it can play. */
const playableClip = tile => !!(tile.isVideo && !tile.loading && (tile.elem || tile.file));
/** What a tile can be opened as: a photo to look at or a clip to play. */
const viewable = tile => (!tile.loading && !!tile.img) || playableClip(tile);

/** "3 photos", "1 clip", "3 photos and 2 clips". */
export function countLabel(tiles) {
    const clips = tiles.filter(tile => tile.isVideo).length;
    const photos = tiles.length - clips;
    const parts = [];
    if (photos) parts.push(photos === 1 ? '1 photo' : `${photos} photos`);
    if (clips) parts.push(clips === 1 ? '1 clip' : `${clips} clips`);
    return parts.join(' and ');
}

/** The tile's preview picture (a clip's poster frame), once it is here. */
function usePreview(tile) {
    const ready = previewUrlOf(tile);
    const [fetched, setFetched] = useState({});
    const key = tile.tileKey || tile.infoHash;
    useEffect(() => {
        let live = true;
        if (!ready && tile.torrentFileThumb) {
            loadPreviewUrl(tile).then(url => live && url && setFetched({ key, url }));
        }
        return () => { live = false; };
    // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [key, ready, tile.torrentFileThumb]);
    return ready || (fetched.key === key ? fetched.url : null);
}

/** An object URL for the clip's local file while the viewer shows it. */
function useClipUrl(tile) {
    const file = tile && tile.isVideo ? (tile.elem || tile.file) : null;
    const [url, setUrl] = useState(null);
    useEffect(() => {
        if (!(file instanceof Blob) || typeof URL.createObjectURL !== 'function') return undefined;
        const made = URL.createObjectURL(file);
        setUrl(made);
        return () => {
            URL.revokeObjectURL(made);
            setUrl(null);
        };
    }, [file]);
    return url;
}

/** Save these tiles, tracking whether it is busy; `onError` hears about failures. */
function useSave(tiles, roomId, onError) {
    const [busy, setBusy] = useState(false);
    const save = useCallback(() => {
        setBusy(true);
        saveToDevice(tiles, { roomId })
            .catch(err => {
                Logger.error('Simple save: ' + (err && err.message ? err.message : err));
                onError && onError("Couldn't save that. Try again in a moment.");
            })
            .finally(() => setBusy(false));
    }, [tiles, roomId, onError]);
    return [save, busy];
}

/** How far along a photo still arriving is, 0 to 100, checked every second. */
function useArriving(tile) {
    const read = () => (tile.torrentFile ? Math.round((tile.torrentFile.progress || 0) * 100) : 0);
    const [percent, setPercent] = useState(read);
    useEffect(() => {
        if (!tile.loading) return undefined;
        const id = setInterval(() => setPercent(read()), 1000);
        return () => clearInterval(id);
    // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [tile.loading, tile.torrentFile]);
    return percent;
}

function SaveButton({ tile, roomId, onError }) {
    useHaveChanges();
    const [save, busy] = useSave([tile], roomId, onError);
    const ready = !tile.loading && isReadyToSave(tile);
    const have = alreadyHave(tile);
    return (
        <Button
            fullWidth
            size="large"
            variant={have ? 'outlined' : 'contained'}
            disabled={!ready || busy}
            onClick={save}
            startIcon={busy ? <CircularProgress size={16} color="inherit" /> : have ? <CheckRounded /> : <DownloadRounded />}
            sx={{ textTransform: 'none', fontWeight: 600 }}
        >
            {busy ? 'Saving…' : have === 'shared' ? 'Yours' : have ? 'Saved' : 'Save'}
        </Button>
    );
}

function SimpleTile({ tile, roomId, onOpen, onError }) {
    const percent = useArriving(tile);
    const poster = usePreview(tile);
    const showImage = !tile.loading && tile.img;
    // "Data saver": only the preview is here; a tap gets the photo.
    const previewOnly = !!tile.previewOnly;
    const canOpen = viewable(tile) || previewOnly;
    const picture = showImage ? tile.img : (tile.isVideo || previewOnly ? poster : null);
    const Icon = tile.isAudio ? AudiotrackRounded : PlayCircleRounded;
    return (
        <Stack spacing={1} data-testid="simple-tile">
            <ButtonBase
                onClick={previewOnly ? () => tile.loadFull?.() : onOpen}
                disabled={!canOpen}
                aria-label={previewOnly ? 'Get the full photo' : canOpen ? (tile.isVideo ? 'Play this clip' : 'Look at this photo') : undefined}
                sx={{
                    position: 'relative',
                    width: '100%',
                    aspectRatio: '1 / 1',
                    borderRadius: 2,
                    overflow: 'hidden',
                    bgcolor: 'action.hover',
                    display: 'flex',
                    flexDirection: 'column',
                    alignItems: 'center',
                    justifyContent: 'center',
                    gap: 1,
                }}
            >
                {picture && (
                    <Box component="img" src={picture} alt={tile.fileName || (tile.isVideo ? 'Clip' : 'Photo')}
                        sx={{
                            position: 'absolute', inset: 0, width: '100%', height: '100%', objectFit: 'cover', display: 'block',
                            // A clip still arriving shows its first frame, dimmed under the progress.
                            filter: tile.loading ? 'brightness(0.55)' : 'none',
                        }} />
                )}
                {previewOnly ? (
                    <Typography variant="body2" sx={{ position: 'relative', color: picture ? '#fff' : 'text.secondary', fontWeight: 600 }}>
                        Tap to get the photo
                    </Typography>
                ) : tile.loading ? (
                    <>
                        <CircularProgress variant={percent > 0 ? 'determinate' : 'indeterminate'} value={percent} size={40}
                            sx={{ position: 'relative', color: picture ? '#fff' : undefined }} />
                        <Typography variant="body2" sx={{ position: 'relative', color: picture ? '#fff' : 'text.secondary' }}>
                            {percent > 0 ? `Arriving · ${percent}%` : 'Arriving…'}
                        </Typography>
                    </>
                ) : !showImage && (
                    <Icon sx={{
                        position: 'relative', fontSize: 56,
                        color: picture ? '#fff' : 'text.secondary',
                        filter: picture ? 'drop-shadow(0 1px 4px rgba(0,0,0,0.6))' : 'none',
                    }} />
                )}
            </ButtonBase>
            <SaveButton tile={tile} roomId={roomId} onError={onError} />
        </Stack>
    );
}

/** One photo or clip at a time, full screen, with a single Save button. */
function SimpleViewer({ tiles, index, onIndexChange, onClose, roomId, onError }) {
    const tile = tiles[index];
    const clipUrl = useClipUrl(tile);
    const poster = usePreview(tile || {});
    const go = useCallback(step => {
        const next = index + step;
        if (next >= 0 && next < tiles.length) onIndexChange(next);
    }, [index, tiles.length, onIndexChange]);

    useEffect(() => {
        const onKey = event => {
            if (event.key === 'ArrowLeft') go(-1);
            if (event.key === 'ArrowRight') go(1);
        };
        window.addEventListener('keydown', onKey);
        return () => window.removeEventListener('keydown', onKey);
    }, [go]);

    if (!tile) return null;
    return (
        <Dialog open fullScreen onClose={onClose}
            slotProps={{ paper: { sx: { bgcolor: '#000', color: '#fff' } } }}>
            <Box sx={{ position: 'relative', flex: 1, minHeight: 0, display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
                {tile.isVideo ? (
                    <Box component="video" key={tile.tileKey || tile.infoHash} src={clipUrl || undefined}
                        poster={poster || undefined} controls autoPlay playsInline
                        aria-label={tile.fileName || 'Clip'}
                        sx={{ maxWidth: '100%', maxHeight: '100%', objectFit: 'contain' }} />
                ) : (
                    <Box component="img" src={tile.img} alt={tile.fileName || 'Photo'}
                        sx={{ maxWidth: '100%', maxHeight: '100%', objectFit: 'contain' }} />
                )}
                <IconButton aria-label="Close" onClick={onClose}
                    sx={{ position: 'absolute', top: 12, right: 12, color: '#fff', bgcolor: 'rgba(0,0,0,0.5)' }}>
                    <CloseRounded />
                </IconButton>
                {index > 0 && (
                    <IconButton aria-label="Previous" onClick={() => go(-1)}
                        sx={{ position: 'absolute', left: 8, color: '#fff', bgcolor: 'rgba(0,0,0,0.5)' }}>
                        <ArrowBackRounded />
                    </IconButton>
                )}
                {index < tiles.length - 1 && (
                    <IconButton aria-label="Next" onClick={() => go(1)}
                        sx={{ position: 'absolute', right: 8, color: '#fff', bgcolor: 'rgba(0,0,0,0.5)' }}>
                        <ArrowForwardRounded />
                    </IconButton>
                )}
            </Box>
            <Box sx={{ p: 2, maxWidth: 420, width: '100%', mx: 'auto' }}>
                <SaveButton tile={tile} roomId={roomId} onError={onError} />
            </Box>
        </Dialog>
    );
}

/**
 * The simple view of a room's photos and clips: big squares, each with a Save
 * button, and one button to save everything new at once.
 */
function SimpleGrid({ tiles, roomId, onError }) {
    useHaveChanges();
    const [openKey, setOpenKey] = useState(null);
    const keyOf = tile => tile.tileKey || tile.infoHash;
    const open = tiles.filter(viewable);
    const openIndex = open.findIndex(tile => keyOf(tile) === openKey);
    const fresh = tiles.filter(tile => !tile.loading && isReadyToSave(tile) && !alreadyHave(tile));
    const [saveAll, savingAll] = useSave(fresh, roomId, onError);

    if (!tiles.length) {
        return (
            <Typography variant="h6" component="p" sx={{ textAlign: 'center', color: 'text.secondary', py: 6, px: 2, fontWeight: 500 }}>
                No photos or clips yet. When anyone here adds one, it shows up on every phone.
            </Typography>
        );
    }

    return (
        <Box>
            <Stack direction="row" spacing={1} sx={{ alignItems: 'center', mb: 2 }}>
                <Typography variant="h6" component="h2" sx={{ flex: 1, fontWeight: 600 }}>
                    {countLabel(tiles)}
                </Typography>
                {fresh.length > 1 && (
                    <Button variant="contained" size="large" onClick={saveAll} disabled={savingAll}
                        startIcon={savingAll ? <CircularProgress size={16} color="inherit" /> : <DownloadRounded />}
                        sx={{ textTransform: 'none', fontWeight: 600 }}>
                        {savingAll ? 'Saving…' : `Save all ${fresh.length}`}
                    </Button>
                )}
            </Stack>
            {/* A single photo or clip gets the whole width. */}
            <Box sx={{
                display: 'grid',
                gridTemplateColumns: tiles.length === 1 ? '1fr'
                    : { xs: 'repeat(2, minmax(0, 1fr))', sm: 'repeat(3, minmax(0, 1fr))', lg: 'repeat(4, minmax(0, 1fr))' },
                maxWidth: tiles.length === 1 ? 480 : 'none',
                gap: 2,
                pb: 3,
            }}>
                {tiles.map(tile => (
                    <SimpleTile key={keyOf(tile)} tile={tile} roomId={roomId} onError={onError}
                        onOpen={() => setOpenKey(keyOf(tile))} />
                ))}
            </Box>
            {openIndex > -1 && (
                <SimpleViewer tiles={open} index={openIndex} roomId={roomId} onError={onError}
                    onIndexChange={index => setOpenKey(keyOf(open[index]))}
                    onClose={() => setOpenKey(null)} />
            )}
        </Box>
    );
}

SimpleGrid.propTypes = {
    tiles: PropTypes.array.isRequired,
    roomId: PropTypes.string,
    onError: PropTypes.func,
};

export default SimpleGrid;
