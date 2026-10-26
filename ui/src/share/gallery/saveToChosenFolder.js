import React, { useState } from 'react';
import PropTypes from 'prop-types';
import Box from '@mui/material/Box';
import Stack from '@mui/material/Stack';
import Button from '@mui/material/Button';
import Dialog from '@mui/material/Dialog';
import IconButton from '@mui/material/IconButton';
import Typography from '@mui/material/Typography';
import CircularProgress from '@mui/material/CircularProgress';
import CloseRounded from '@mui/icons-material/CloseRounded';
import DriveFolderUploadRounded from '@mui/icons-material/DriveFolderUploadRounded';
import { keyOf, usePreview } from './mediaView';
import { isReadyToSave } from './saveRoom';
import { canChooseFolder, replaceFailureMessage, replaceOriginal } from './replaceOriginal';

export { canChooseFolder };

const leftToSave = tile => !tile.loading && isReadyToSave(tile);

/** A small square of the photo, from its own bytes or the preview that came with it. */
export function PlaceThumb({ tile }) {
    const preview = usePreview(tile);
    const src = (!tile.loading && tile.img) || preview;
    return (
        <Box sx={{ width: 64, height: 64, flex: '0 0 auto', borderRadius: 1, overflow: 'hidden', bgcolor: 'rgba(255,255,255,0.08)' }}>
            {src && <Box component="img" src={src} alt="" sx={{ width: '100%', height: '100%', objectFit: 'cover', display: 'block' }} />}
        </Box>
    );
}

/**
 * The kept photos one at a time, each with the browser's own save dialog, so
 * the person picks the folder instead of getting the app's choice. The dialog
 * has to open on a tap and takes one file, so this is pressed once per photo -
 * there is no way to aim a batch at one folder from a web page.
 *
 * `tiles` are the ones still needing a folder; the caller drops each as
 * `onSaved` hears about it.
 */
export function FolderWalk({ tiles, total, device, onSaved, onBack }) {
    const [busy, setBusy] = useState(false);
    const [error, setError] = useState('');
    const tile = tiles[0];
    if (!tile) return null;
    const name = (tile.details && tile.details.title) || tile.fileName || 'this photo';

    const choose = () => {
        setBusy(true);
        setError('');
        // Called straight from the tap: the save dialog needs that gesture.
        replaceOriginal(tile)
            .then(() => {
                setBusy(false);
                onSaved(tile);
            })
            .catch(err => {
                setBusy(false);
                // A closed dialog gives no message, so this stays quiet and asks again.
                setError(replaceFailureMessage(err));
            });
    };

    return (
        <Stack spacing={2} sx={{ width: '100%', maxWidth: 420, alignItems: 'center' }} data-testid="folder-walk">
            <Typography variant="subtitle1" sx={{ fontWeight: 600 }}>
                {total - tiles.length + 1} of {total}
            </Typography>
            <PlaceThumb tile={tile} />
            <Typography variant="body1" sx={{ fontWeight: 600, wordBreak: 'break-all', textAlign: 'center' }}>{name}</Typography>
            <Button variant="contained" size="large" fullWidth onClick={choose}
                disabled={busy || !leftToSave(tile)}
                startIcon={busy || !leftToSave(tile) ? <CircularProgress size={18} color="inherit" /> : <DriveFolderUploadRounded />}
                sx={{ textTransform: 'none', fontWeight: 600, py: 1.5 }}>
                {busy ? 'Saving…' : 'Choose a folder'}
            </Button>
            <Typography variant="body2" sx={{ color: 'rgba(255,255,255,0.75)', textAlign: 'center' }}>
                The save dialog opens for this one, so you pick where it goes.{' '}
                {device === 'phone' ? 'DCIM/Camera puts it in your gallery.' : 'Any folder will do.'}
            </Typography>
            {error && <Typography variant="body2" sx={{ color: 'error.light' }}>{error}</Typography>}
            {onBack && (
                <Button onClick={onBack} sx={{ color: '#fff', textTransform: 'none' }}>
                    Save the rest {device === 'phone' ? 'to your phone' : 'to this device'}
                </Button>
            )}
        </Stack>
    );
}

FolderWalk.propTypes = {
    tiles: PropTypes.array.isRequired,
    total: PropTypes.number.isRequired,
    device: PropTypes.oneOf(['phone', 'device']),
    onSaved: PropTypes.func.isRequired,
    onBack: PropTypes.func,
};

/**
 * "Choose where each one goes" for a set of photos. One file is one tap: the
 * save dialog opens straight away. Several need the walk, because the dialog
 * takes one file and only opens on a tap, so it is asked for once each.
 * The button keeps its own score of which ones are done, so it can sit in
 * surfaces outside the keep-or-skip chooser.
 */
export default function ChooseFolderButton({ tiles, device = 'device', size = 'small', variant = 'outlined', onDone }) {
    const [open, setOpen] = useState(false);
    const [saved, setSaved] = useState(() => new Set());
    const [busy, setBusy] = useState(false);
    const [status, setStatus] = useState('');
    if (!canChooseFolder() || tiles.length === 0) return null;
    // Photos this browser has never written still need a folder, even on a reopen.
    const left = tiles.filter(tile => !saved.has(keyOf(tile)));
    const done = tiles.length - left.length;
    const one = tiles.length === 1 ? tiles[0] : null;

    const saveOne = () => {
        setBusy(true);
        setStatus('');
        replaceOriginal(one)
            .then(kind => {
                setBusy(false);
                setSaved(previous => new Set(previous).add(keyOf(one)));
                setStatus(kind === 'shared' ? 'Saved' : 'Saved where you chose');
                onDone?.(1);
            })
            .catch(err => {
                setBusy(false);
                setStatus(replaceFailureMessage(err) || 'Nothing was saved');
            });
    };

    if (one) {
        const ready = leftToSave(one) && !saved.has(keyOf(one));
        return (
            <Box sx={{ display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 0.5, width: '100%' }}>
                <Button variant="outlined" color="primary" startIcon={<DriveFolderUploadRounded fontSize="small" />}
                    disabled={busy || !ready} onClick={saveOne}
                    title="Opens the save dialog, so you choose the folder. On a phone, DCIM/Camera is the gallery."
                    sx={{ textTransform: 'none', whiteSpace: 'nowrap', fontWeight: 600 }}>
                    {busy ? 'Saving…' : 'Choose where to save'}
                </Button>
                {status && (
                    <Typography variant="caption" sx={{ color: 'text.secondary', textAlign: 'center' }}>{status}</Typography>
                )}
            </Box>
        );
    }

    return (
        <>
            <Button size={size} variant={variant} startIcon={<DriveFolderUploadRounded fontSize="small" />}
                onClick={() => setOpen(true)}
                title="Opens the save dialog for each photo, so you choose the folder. On a phone, DCIM/Camera is the gallery."
                sx={{ textTransform: 'none', whiteSpace: 'nowrap', fontWeight: 600 }}>
                {done && left.length ? `Choose where each one goes (${left.length} left)` : 'Choose where each one goes'}
            </Button>
            {open && (
                <Dialog open fullScreen onClose={() => setOpen(false)}
                    slotProps={{ paper: { 'aria-label': 'Choose where to save', sx: { bgcolor: '#000', color: '#fff', display: 'flex', flexDirection: 'column' } } }}>
                    <Stack direction="row" sx={{ justifyContent: 'flex-end', px: 1.5, py: 1, minHeight: 56 }}>
                        <IconButton aria-label="Close" onClick={() => setOpen(false)} sx={{ color: '#fff' }}>
                            <CloseRounded />
                        </IconButton>
                    </Stack>
                    <Stack spacing={2.5} sx={{ flex: 1, alignItems: 'center', justifyContent: 'center', p: 3, textAlign: 'center', maxWidth: 520, mx: 'auto', width: '100%' }}>
                        {left.length ? (
                            <FolderWalk
                                tiles={left}
                                total={tiles.length}
                                device={device}
                                onSaved={item => {
                                    const key = keyOf(item);
                                    setSaved(previous => new Set(previous).add(key));
                                    if (left.length === 1) {
                                        setOpen(false);
                                        onDone?.(tiles.length);
                                    }
                                }}
                                onBack={() => setOpen(false)}
                            />
                        ) : (
                            <>
                                <Typography variant="h5" component="h2" sx={{ fontWeight: 700 }}>
                                    Chose a folder for {done} {done === 1 ? 'photo' : 'photos'}
                                </Typography>
                                <Button variant="contained" size="large" onClick={() => setOpen(false)} sx={{ textTransform: 'none', fontWeight: 600, minWidth: 200 }}>
                                    Done
                                </Button>
                            </>
                        )}
                    </Stack>
                </Dialog>
            )}
        </>
    );
}

ChooseFolderButton.propTypes = {
    tiles: PropTypes.array.isRequired,
    device: PropTypes.oneOf(['phone', 'device']),
    size: PropTypes.string,
    variant: PropTypes.string,
    onDone: PropTypes.func,
};
