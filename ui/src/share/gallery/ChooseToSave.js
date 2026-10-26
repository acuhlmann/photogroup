import React, { useState, useEffect, useRef, useCallback } from 'react';
import PropTypes from 'prop-types';
import Box from '@mui/material/Box';
import Stack from '@mui/material/Stack';
import Button from '@mui/material/Button';
import Dialog from '@mui/material/Dialog';
import IconButton from '@mui/material/IconButton';
import Typography from '@mui/material/Typography';
import CircularProgress from '@mui/material/CircularProgress';
import CheckRounded from '@mui/icons-material/CheckRounded';
import CloseRounded from '@mui/icons-material/CloseRounded';
import DownloadRounded from '@mui/icons-material/DownloadRounded';
import DriveFolderUploadRounded from '@mui/icons-material/DriveFolderUploadRounded';
import PhotoLibraryRounded from '@mui/icons-material/PhotoLibraryRounded';
import Logger from 'js-logger';
import MediaStage from './MediaStage';
import { keyOf } from './mediaView';
import { alreadyHave, useHaveChanges } from './alreadyHave';
import { fileForSave } from './savePhoto';
import { isReadyToSave, zipEntryNames } from './saveRoom';
import { saveToDevice, savedWhereText, saveWay } from './saveToDevice';
import { canChooseFolder, FolderWalk, PlaceThumb } from './saveToChosenFolder';

/** The photos and clips to choose from: the ones this person doesn't have yet, so not the ones they shared. */
export const toChoose = tiles => tiles.filter(tile => !alreadyHave(tile));

const hereInFull = tile => !tile.loading && isReadyToSave(tile);
const itemWord = (count, words) => (count === 1 ? '1 ' : `${count} `) + (words.clips ? (count === 1 ? 'item' : 'items') : (count === 1 ? 'photo' : 'photos'));

/**
 * Go through photos one at a time, full screen, and keep or skip each one.
 * At the end, save the kept ones to this device in one go.
 */
export function LookThrough({ tiles, keys, roomId, device, onClose }) {
    useHaveChanges();
    const byKey = new Map(tiles.map(tile => [keyOf(tile), tile]));
    const list = keys.map(key => byKey.get(key)).filter(Boolean);
    const names = useRef(new Map(zipEntryNames(list).map((name, index) => [keyOf(list[index]), name]))).current;
    const [index, setIndex] = useState(0);
    const [kept, setKept] = useState(() => new Set());
    const [state, setState] = useState('choosing');
    const [error, setError] = useState('');
    // On a share sheet, the files must be ready at the tap; make them as photos are kept.
    const files = useRef(new Map()).current;
    // Files that could not be made ahead; saveToDevice makes them again at the tap.
    const failed = useRef(new Set()).current;
    const [result, setResult] = useState(null);
    const [, setMade] = useState(0);
    // Kept photos written through the save dialog, so they leave the one-tap save.
    const [chosen, setChosen] = useState(() => new Set());
    const [pickPlace, setPickPlace] = useState(false);
    const sharing = saveWay() === 'share';
    // The browser's save dialog is the only way to name the folder, so the
    // choice to use it appears only where that dialog exists.
    const canChoosePlace = canChooseFolder();

    const keptTiles = list.filter(tile => kept.has(keyOf(tile)));
    const rest = keptTiles.filter(item => !chosen.has(keyOf(item)));
    const done = index >= list.length;
    const tile = done ? null : list[index];
    const clips = list.some(item => item.isVideo || item.isAudio);
    const words = { clips };

    useEffect(() => {
        if (!sharing) return;
        keptTiles.filter(hereInFull).forEach(item => {
            const key = keyOf(item);
            if (files.has(key)) return;
            files.set(key, null);
            fileForSave(item)
                .then(blob => {
                    files.set(key, new File([blob], names.get(key) || item.fileName || 'photo', { type: item.fileType || blob.type || '' }));
                    setMade(count => count + 1);
                })
                .catch(err => {
                    failed.add(key);
                    setMade(count => count + 1);
                    Logger.warn('Could not read ' + item.fileName + ': ' + (err && err.message ? err.message : err));
                });
        });
    });

    const step = useCallback(by => setIndex(at => Math.max(0, Math.min(list.length, at + by))), [list.length]);

    const decide = keep => {
        const key = keyOf(tile);
        setKept(previous => {
            const next = new Set(previous);
            if (keep) next.add(key); else next.delete(key);
            return next;
        });
        // Data saver: only the preview is here, so keeping it gets the photo.
        if (keep && tile.previewOnly) tile.loadFull?.();
        step(1);
    };

    const readyCount = rest.filter(item => hereInFull(item) && (!sharing || files.get(keyOf(item)) || failed.has(keyOf(item)))).length;
    const allReady = rest.length > 0 && readyCount === rest.length;

    const save = () => {
        setState('saving');
        setError('');
        const made = new Map(Array.from(files).filter(([, file]) => file));
        saveToDevice(rest, { roomId, files: made })
            .then(outcome => {
                setResult(outcome);
                setState(outcome === 'cancelled' ? 'choosing' : 'saved');
            })
            .catch(err => {
                Logger.error('Save kept photos: ' + (err && err.message ? err.message : err));
                setError("Couldn't save that. Try again in a moment.");
                setState('choosing');
            });
    };

    /** Some went to the folders they chose, some to wherever this device downloads. */
    const savedWhereLine = () => {
        const way = sharing && result === 'saved' ? { way: 'download' } : {};
        if (!chosen.size) return savedWhereText(keptTiles.length, { done: true, ...way });
        if (!rest.length) return savedWhereText(keptTiles.length, { way: 'chosen' });
        return `${savedWhereText(rest.length, { done: true, ...way })} ${savedWhereText(chosen.size, { way: 'chosen' })}`;
    };

    const isKept = tile && kept.has(keyOf(tile));
    const where = device === 'phone' ? 'to your phone' : 'to this device';

    return (
        <Dialog open fullScreen onClose={onClose}
            slotProps={{ paper: { 'aria-label': 'Choose what to save', sx: { bgcolor: '#000', color: '#fff', display: 'flex', flexDirection: 'column' } } }}>
            <Stack direction="row" spacing={1} sx={{ alignItems: 'center', px: 1.5, py: 1, minHeight: 56 }}>
                <Typography variant="subtitle1" sx={{ flex: 1, fontWeight: 600 }} data-testid="choose-position">
                    {done ? 'Your choice' : `${index + 1} of ${list.length}`}
                    {!done && kept.size > 0 && (
                        <Typography component="span" variant="body2" sx={{ ml: 1.5, color: 'rgba(255,255,255,0.7)' }}>
                            {kept.size} kept
                        </Typography>
                    )}
                </Typography>
                {!done && kept.size > 0 && (
                    <Button size="small" onClick={() => setIndex(list.length)}
                        sx={{ color: '#fff', textTransform: 'none', fontWeight: 600 }}>
                        Done
                    </Button>
                )}
                <IconButton aria-label="Close" onClick={onClose} sx={{ color: '#fff' }}>
                    <CloseRounded />
                </IconButton>
            </Stack>

            {tile ? (
                <>
                    <MediaStage key={keyOf(tile)} tile={tile} onStep={step} hasPrev={index > 0} hasNext={index < list.length - 1}>
                        {isKept && (
                            <Box sx={{
                                position: 'absolute', top: 12, left: 12, display: 'flex', alignItems: 'center', gap: 0.5,
                                px: 1.25, py: 0.5, borderRadius: 4, bgcolor: 'success.main', color: '#fff', fontWeight: 600,
                            }}>
                                <CheckRounded fontSize="small" /> Kept
                            </Box>
                        )}
                    </MediaStage>
                    <Box sx={{ p: 2, pb: 'max(16px, env(safe-area-inset-bottom))', width: '100%', maxWidth: 480, mx: 'auto' }}>
                        {tile.previewOnly && (
                            <Typography variant="body2" sx={{ textAlign: 'center', mb: 1, color: 'rgba(255,255,255,0.75)' }}>
                                Only the preview is here. Keep it to get the full photo.
                            </Typography>
                        )}
                        <Stack direction="row" spacing={1.5}>
                            <Button fullWidth size="large" variant="outlined" onClick={() => decide(false)}
                                sx={{ color: '#fff', borderColor: 'rgba(255,255,255,0.4)', textTransform: 'none', fontWeight: 600, py: 1.5 }}>
                                Skip
                            </Button>
                            <Button fullWidth size="large" variant="contained" color={isKept ? 'success' : 'primary'}
                                onClick={() => decide(true)} startIcon={<CheckRounded />}
                                sx={{ textTransform: 'none', fontWeight: 600, py: 1.5 }}>
                                {isKept ? 'Kept' : 'Keep'}
                            </Button>
                        </Stack>
                    </Box>
                </>
            ) : (
                <Stack spacing={2.5} sx={{ flex: 1, alignItems: 'center', justifyContent: 'center', p: 3, textAlign: 'center', maxWidth: 520, mx: 'auto', width: '100%' }}>
                    {state === 'saved' ? (
                        <>
                            <CheckRounded sx={{ fontSize: 56, color: 'success.main' }} />
                            <Typography variant="h5" component="h2" sx={{ fontWeight: 700 }}>
                                Saved {itemWord(keptTiles.length, words)}
                            </Typography>
                            <Typography variant="body1" sx={{ color: 'rgba(255,255,255,0.8)' }}>
                                {savedWhereLine()}
                            </Typography>
                            <Button variant="contained" size="large" onClick={onClose} sx={{ textTransform: 'none', fontWeight: 600, minWidth: 200 }}>
                                Close
                            </Button>
                        </>
                    ) : keptTiles.length === 0 ? (
                        <>
                            <Typography variant="h5" component="h2" sx={{ fontWeight: 700 }}>You did not keep any</Typography>
                            <Stack direction="row" spacing={1.5}>
                                <Button variant="outlined" onClick={() => setIndex(0)}
                                    sx={{ color: '#fff', borderColor: 'rgba(255,255,255,0.4)', textTransform: 'none' }}>
                                    Look again
                                </Button>
                                <Button variant="contained" onClick={onClose} sx={{ textTransform: 'none' }}>Close</Button>
                            </Stack>
                        </>
                    ) : pickPlace && rest.length > 0 ? (
                        <FolderWalk
                            tiles={rest}
                            total={keptTiles.length}
                            device={device}
                            onSaved={item => {
                                const key = keyOf(item);
                                setChosen(previous => new Set(previous).add(key));
                                if (rest.length === 1) {
                                    setResult('chosen');
                                    setState('saved');
                                }
                            }}
                            onBack={() => setPickPlace(false)}
                        />
                    ) : (
                        <>
                            <Typography variant="h5" component="h2" sx={{ fontWeight: 700 }}>
                                You kept {keptTiles.length} of {list.length}
                            </Typography>
                            <Stack direction="row" spacing={1} sx={{ overflowX: 'auto', maxWidth: '100%', pb: 0.5 }}>
                                {keptTiles.map(item => <PlaceThumb key={keyOf(item)} tile={item} />)}
                            </Stack>
                            {rest.length > 0 && (
                                <Button variant="contained" size="large" fullWidth onClick={save}
                                    disabled={!allReady || state === 'saving'}
                                    startIcon={state === 'saving' || !allReady ? <CircularProgress size={18} color="inherit" /> : <DownloadRounded />}
                                    sx={{ textTransform: 'none', fontWeight: 600, py: 1.5 }}>
                                    {state === 'saving' ? 'Saving…'
                                        : allReady ? `Save ${itemWord(rest.length, words)} ${where}`
                                            : `Getting them… ${readyCount} of ${rest.length} here`}
                                </Button>
                            )}
                            {canChoosePlace && rest.length > 0 && (
                                <Button variant="outlined" fullWidth onClick={() => setPickPlace(true)}
                                    disabled={!allReady}
                                    startIcon={<DriveFolderUploadRounded />}
                                    title="Opens the save dialog for each photo, so you choose the folder. On a phone, DCIM/Camera is the gallery."
                                    sx={{ color: '#fff', borderColor: 'rgba(255,255,255,0.4)', textTransform: 'none', fontWeight: 600, py: 1.5 }}>
                                    Choose where each one goes
                                </Button>
                            )}
                            <Typography variant="body2" sx={{ color: 'rgba(255,255,255,0.75)' }} data-testid="saved-where">
                                {savedWhereText(rest.length)}
                            </Typography>
                            {error && <Typography variant="body2" sx={{ color: 'error.light' }}>{error}</Typography>}
                            <Button onClick={() => setIndex(0)} sx={{ color: '#fff', textTransform: 'none' }}>
                                Look again
                            </Button>
                        </>
                    )}
                </Stack>
            )}
        </Dialog>
    );
}

LookThrough.propTypes = {
    tiles: PropTypes.array.isRequired,
    keys: PropTypes.array.isRequired,
    roomId: PropTypes.string,
    device: PropTypes.oneOf(['phone', 'device']),
    onClose: PropTypes.func.isRequired,
};

/**
 * "Choose what to save": opens the photos from other people that this
 * person doesn't have yet, full screen, to keep or skip one by one.
 */
function ChooseToSave({ tiles, roomId, device = 'device', size = 'small', variant = 'outlined' }) {
    useHaveChanges();
    const [keys, setKeys] = useState(null);
    const choices = toChoose(tiles);
    return (
        <>
            {choices.length > 0 && (
                <Button size={size} variant={variant} startIcon={<PhotoLibraryRounded fontSize="small" />}
                    onClick={() => setKeys(choices.map(keyOf))}
                    title="Look at each new photo full screen. Keep or skip it. Then save the ones you keep."
                    sx={{ textTransform: 'none', whiteSpace: 'nowrap', fontWeight: 600 }}>
                    Choose what to save ({choices.length})
                </Button>
            )}
            {keys && (
                <LookThrough tiles={tiles} keys={keys} roomId={roomId} device={device} onClose={() => setKeys(null)} />
            )}
        </>
    );
}

ChooseToSave.propTypes = {
    tiles: PropTypes.array.isRequired,
    roomId: PropTypes.string,
    device: PropTypes.oneOf(['phone', 'device']),
    size: PropTypes.string,
    variant: PropTypes.string,
};

export default ChooseToSave;
