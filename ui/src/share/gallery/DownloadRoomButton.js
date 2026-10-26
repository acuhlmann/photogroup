import React, { useState } from 'react';
import PropTypes from 'prop-types';
import Stack from '@mui/material/Stack';
import Button from '@mui/material/Button';
import IconButton from '@mui/material/IconButton';
import Menu from '@mui/material/Menu';
import MenuItem from '@mui/material/MenuItem';
import ListItemText from '@mui/material/ListItemText';
import Typography from '@mui/material/Typography';
import FolderZipRounded from '@mui/icons-material/FolderZipRounded';
import MoreVertRounded from '@mui/icons-material/MoreVertRounded';
import { isReadyToSave, saveRoom } from './saveRoom';
import { alreadyHave, useHaveChanges } from './alreadyHave';
import { canChooseFolder, replaceFailureMessage, saveBlobToChosenFolder } from './replaceOriginal';
import { canFindOnDevice, findOnDevice, pickFolder } from './findOnDevice';

const plural = (count, word) => `${count} ${word}${count === 1 ? '' : 's'}`;
const message = err => (err && err.message ? err.message : String(err));

/** Progress text, updated every so many files so a big folder doesn't re-render thousands of times. */
const EVERY = 25;

/**
 * Download the room's photos as one zip, each saved with its shared
 * details, leaving out the ones this person already has: shared or saved
 * from here, or found in a folder on this device.
 */
function DownloadRoomButton({ tiles, roomId }) {
    useHaveChanges();
    const [progress, setProgress] = useState(null);
    const [status, setStatus] = useState('');
    const [menu, setMenu] = useState(null);

    const had = tiles.filter(tile => alreadyHave(tile));
    const fresh = tiles.filter(tile => !alreadyHave(tile));
    const readyFresh = fresh.filter(isReadyToSave).length;
    const readyAll = tiles.filter(isReadyToSave).length;

    /** `toFolder` asks the browser's save dialog where the zip goes, instead of Downloads. */
    const download = (chosen, leftOut, toFolder = false) => {
        setMenu(null);
        setStatus('');
        setProgress(`Zipping 0 of ${chosen.filter(isReadyToSave).length}…`);
        saveRoom(chosen, {
            roomId,
            onProgress: (done, total) => setProgress(`Zipping ${done} of ${total}…`),
            save: toFolder ? saveBlobToChosenFolder : undefined,
        })
            .then(({ saved, skipped }) => setStatus([
                toFolder ? `Saved ${plural(saved, 'photo')} where you chose` : `Saved ${plural(saved, 'photo')}`,
                leftOut ? `${leftOut} you have, not included` : '',
                skipped ? `${skipped} not ready, not included` : '',
            ].filter(Boolean).join(' · ')))
            // Closing the save dialog is not a failure worth a message.
            .catch(err => setStatus(err && err.cancelled ? 'Nothing was saved' : 'Could not make the zip: ' + message(err)))
            .finally(() => setProgress(null));
    };

    const find = () => {
        setMenu(null);
        setStatus('');
        pickFolder()
            .then(entries => {
                if (!entries.length) return null;
                setProgress(`Checking 0 of ${entries.length} files…`);
                return findOnDevice(tiles, entries, {
                    onProgress: (checked, total) => {
                        if (checked % EVERY === 0 || checked === total) setProgress(`Checking ${checked} of ${total} files…`);
                    },
                });
            })
            .then(found => {
                if (found === null) return;
                setStatus(found.length
                    ? `Found ${plural(found.length, 'photo')} already on this device`
                    : 'None of these photos are in that folder');
            })
            .catch(err => setStatus('Could not look in that folder: ' + message(err)))
            .finally(() => setProgress(null));
    };

    let label = 'Download room';
    let title = readyAll < tiles.length
        ? `Save the ${plural(readyAll, 'complete photo')} as one zip. The other photos are still arriving.`
        : 'Save every photo in the room, with its details, as one zip';
    if (had.length && fresh.length) {
        label = readyFresh ? `Download ${readyFresh} new` : 'Download new';
        title = `Save the new photos as one zip, without the ${had.length} you have.`
            + (readyFresh < fresh.length ? ' Some photos are still arriving.' : '');
    } else if (had.length) {
        label = 'You have them all';
        title = 'You shared or saved each photo here, or it is on this device.';
    }
    const disabled = !!progress || (had.length ? readyFresh === 0 : readyAll === 0);

    return (
        <Stack direction="row" spacing={0.5} sx={{ alignItems: 'center', ml: 'auto' }}>
            {status && (
                <Typography variant="caption" role="status" sx={{ color: 'text.secondary' }}>{status}</Typography>
            )}
            <Button size="small" variant="outlined" startIcon={<FolderZipRounded fontSize="small" />}
                disabled={disabled} onClick={() => download(fresh, had.length)} title={title}
                sx={{ textTransform: 'none', whiteSpace: 'nowrap' }}>
                {progress || label}
            </Button>
            <IconButton size="small" aria-label="More download options" aria-haspopup="menu"
                disabled={!!progress} onClick={event => setMenu(event.currentTarget)}>
                <MoreVertRounded fontSize="small" />
            </IconButton>
            <Menu anchorEl={menu} open={!!menu} onClose={() => setMenu(null)}>
                <MenuItem onClick={find} disabled={!canFindOnDevice(tiles)}>
                    <ListItemText primary="Find the ones on this device…"
                        secondary="Select a folder with your photos. PhotoGroup does not upload it." />
                </MenuItem>
                {canChooseFolder() && (
                    <MenuItem onClick={() => download(fresh, had.length, true)}
                        disabled={had.length ? readyFresh === 0 : readyAll === 0}>
                        <ListItemText primary="Save the zip where I choose…"
                            secondary="Opens the browser's save dialog, so the zip lands in the folder you pick." />
                    </MenuItem>
                )}
                {had.length > 0 && (
                    <MenuItem onClick={() => download(tiles, 0)} disabled={readyAll === 0}>
                        <ListItemText primary={`Download all ${tiles.length}`}
                            secondary={`Including the ${had.length} you have`} />
                    </MenuItem>
                )}
            </Menu>
        </Stack>
    );
}

DownloadRoomButton.propTypes = {
    tiles: PropTypes.array.isRequired,
    roomId: PropTypes.string,
};

export default DownloadRoomButton;
