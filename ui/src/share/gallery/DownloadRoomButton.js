import React, { useState } from 'react';
import PropTypes from 'prop-types';
import Stack from '@mui/material/Stack';
import Button from '@mui/material/Button';
import Typography from '@mui/material/Typography';
import FolderZipRounded from '@mui/icons-material/FolderZipRounded';
import { isReadyToSave, saveRoom } from './saveRoom';

const plural = (count, word) => `${count} ${word}${count === 1 ? '' : 's'}`;

/** Download every photo in the room as one zip, each saved with its shared details. */
function DownloadRoomButton({ tiles, roomId }) {
    const [progress, setProgress] = useState(null);
    const [status, setStatus] = useState('');
    const ready = tiles.filter(isReadyToSave).length;

    const start = () => {
        setStatus('');
        setProgress({ done: 0, total: ready });
        saveRoom(tiles, { roomId, onProgress: (done, total) => setProgress({ done, total }) })
            .then(({ saved, skipped }) => setStatus(`Saved ${plural(saved, 'photo')}`
                + (skipped ? ` · ${skipped} not ready, left out` : '')))
            .catch(err => setStatus('Couldn’t make the zip: ' + (err && err.message ? err.message : String(err))))
            .finally(() => setProgress(null));
    };

    const label = progress ? `Zipping ${progress.done} of ${progress.total}…` : 'Download room';
    return (
        <Stack direction="row" spacing={1} sx={{ alignItems: 'center', ml: 'auto' }}>
            {status && (
                <Typography variant="caption" role="status" sx={{ color: 'text.secondary' }}>{status}</Typography>
            )}
            <Button size="small" variant="outlined" startIcon={<FolderZipRounded fontSize="small" />}
                disabled={!!progress || ready === 0} onClick={start}
                title={ready < tiles.length
                    ? `Save the ${plural(ready, 'photo')} here in full as one zip; the rest are still arriving`
                    : 'Save every photo in the room, with its details, as one zip'}
                sx={{ textTransform: 'none', whiteSpace: 'nowrap' }}>
                {label}
            </Button>
        </Stack>
    );
}

DownloadRoomButton.propTypes = {
    tiles: PropTypes.array.isRequired,
    roomId: PropTypes.string,
};

export default DownloadRoomButton;
