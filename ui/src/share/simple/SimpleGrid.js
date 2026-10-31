import React, { useState, useCallback } from 'react';
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
import DownloadRounded from '@mui/icons-material/DownloadRounded';
import PlayCircleRounded from '@mui/icons-material/PlayCircleRounded';
import AudiotrackRounded from '@mui/icons-material/AudiotrackRounded';
import Logger from 'js-logger';

import { isReadyToSave } from '../gallery/saveRoom';
import { alreadyHave, useHaveChanges } from '../gallery/alreadyHave';
import { saveToDevice, savedWhereText } from '../gallery/saveToDevice';
import ChooseFolderButton, { canChooseFolder } from '../gallery/saveToChosenFolder';
import { keyOf, useArriving, usePreview, viewable } from '../gallery/mediaView';
import MediaStage from '../gallery/MediaStage';
import ChooseToSave from '../gallery/ChooseToSave';

/** "3 photos", "1 clip", "3 photos and 2 clips". */
export function countLabel(tiles) {
    const clips = tiles.filter(tile => tile.isVideo).length;
    const photos = tiles.length - clips;
    const parts = [];
    if (photos) parts.push(photos === 1 ? '1 photo' : `${photos} photos`);
    if (clips) parts.push(clips === 1 ? '1 clip' : `${clips} clips`);
    return parts.join(' and ');
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
    // Only the preview is here (Data saver, or you have the photo); a tap gets the photo.
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
                        {['saved', 'device'].includes(alreadyHave(tile)) ? 'You have this. Tap to get it again' : 'Tap to get the photo'}
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

/** One photo or clip at a time, full screen, with a single Save button. Swipe to go on. */
function SimpleViewer({ tiles, index, onIndexChange, onClose, roomId, onError }) {
    const tile = tiles[index];
    const go = useCallback(step => {
        const next = index + step;
        if (next >= 0 && next < tiles.length) onIndexChange(next);
    }, [index, tiles.length, onIndexChange]);

    if (!tile) return null;
    return (
        <Dialog open fullScreen onClose={onClose}
            slotProps={{ paper: { sx: { bgcolor: '#000', color: '#fff' } } }}>
            <MediaStage tile={tile} onStep={go} hasPrev={index > 0} hasNext={index < tiles.length - 1}>
                <IconButton aria-label="Close" onClick={onClose}
                    sx={{ position: 'absolute', top: 12, right: 12, color: '#fff', bgcolor: 'rgba(0,0,0,0.5)' }}>
                    <CloseRounded />
                </IconButton>
                {tiles.length > 1 && (
                    <Typography variant="body2" sx={{ position: 'absolute', top: 20, left: 16, color: '#fff', textShadow: '0 1px 3px rgba(0,0,0,0.8)' }}>
                        {index + 1} of {tiles.length}
                    </Typography>
                )}
            </MediaStage>
            <Box sx={{ p: 2, pb: 'max(16px, env(safe-area-inset-bottom))', maxWidth: 420, width: '100%', mx: 'auto' }}>
                <SaveButton tile={tile} roomId={roomId} onError={onError} />
                {/* One photo, one tap: the save dialog opens and this phone can aim
                    it at DCIM/Camera instead of the Download folder. */}
                {canChooseFolder() && !tile.loading && isReadyToSave(tile) && (
                    <Box sx={{ mt: 1 }}>
                        <ChooseFolderButton tiles={[tile]} device="phone" />
                    </Box>
                )}
                <Typography variant="caption" component="p" sx={{ mt: 1, textAlign: 'center', color: 'rgba(255,255,255,0.7)' }}>
                    {savedWhereText(1)}
                </Typography>
            </Box>
        </Dialog>
    );
}

/**
 * The simple view of a room's photos and clips: big squares, each with a Save
 * button, one button to go through the new ones and keep or skip each, and
 * one to save everything new at once.
 */
function SimpleGrid({ tiles: given, roomId, onError }) {
    useHaveChanges();
    const [openKey, setOpenKey] = useState(null);
    // Other people's photos first; the ones this phone shared go last.
    const tiles = [...given.filter(tile => alreadyHave(tile) !== 'shared'), ...given.filter(tile => alreadyHave(tile) === 'shared')];
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
            <Stack direction="row" spacing={1} useFlexGap sx={{ alignItems: 'center', flexWrap: 'wrap', mb: 2 }}>
                <Typography variant="h6" component="h2" sx={{ flex: 1, fontWeight: 600, minWidth: 'max-content' }}>
                    {countLabel(tiles)}
                </Typography>
                <ChooseToSave tiles={tiles} roomId={roomId} device="phone" size="large" variant="contained" />
                {fresh.length > 1 && (
                    <Button variant="outlined" size="large" onClick={saveAll} disabled={savingAll}
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
