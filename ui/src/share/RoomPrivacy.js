import React, { useState } from 'react';
import PropTypes from 'prop-types';
import Button from '@mui/material/Button';
import Dialog from '@mui/material/Dialog';
import DialogTitle from '@mui/material/DialogTitle';
import DialogContent from '@mui/material/DialogContent';
import DialogActions from '@mui/material/DialogActions';
import Typography from '@mui/material/Typography';
import Box from '@mui/material/Box';
import Logger from 'js-logger';

/** What the server keeps about this room, in plain words, one line each. */
export function privacyLines({ keepCopies = false, copies = 0 } = {}) {
    return [
        'Photos usually go directly from phone to phone.',
        'The server keeps the room: its link and, for each photo, the magnet link, name, type, size, date and fingerprint, '
            + 'and the details people add (title, description, rating, keywords, location). '
            + 'It deletes the room when nobody uses it for 30 days.',
        'The server knows who is in the room now: names, device types and network addresses. '
            + 'It forgets a person soon after they leave.',
        keepCopies
            ? 'This room keeps a server copy of each photo for 24 hours, so people who join later still get the photos.'
            : 'Sometimes the server keeps a copy of a photo: when a phone cannot get it directly, for clips, '
                + 'or when a phone goes to the background before all people have it. '
                + 'It deletes the copy when all people have the photo, or after 24 hours.',
        copies ? `The server has ${copies === 1 ? '1 server copy' : `${copies} server copies`} for this room now.` : null,
    ].filter(Boolean);
}

function readState(master) {
    const photos = master?.roomPhotos?.all?.() || [];
    return {
        keepCopies: !!master?.serverPinning?.keepCopies,
        copies: photos.filter(photo => photo.hasServerCopy || photo.serverCopyReceived > 0).length,
    };
}

/**
 * The room's privacy dialog, opened from the room menu: what the server
 * keeps about this room and for how long, and a way to delete the room now.
 */
export default function RoomPrivacy({ master, open, onClose }) {
    const [confirm, setConfirm] = useState(false);
    const [busy, setBusy] = useState(false);
    const [error, setError] = useState('');

    const close = () => {
        onClose();
        setConfirm(false);
        setError('');
    };

    const deleteRoom = async () => {
        setBusy(true);
        setError('');
        try {
            await master.service.deleteRoom();
            // The server tells everyone, us too; leave even if that is slow.
            master.roomDeleted?.({ peerId: master.client?.peerId });
        } catch (err) {
            Logger.warn('deleteRoom: ' + err);
            setError('Could not delete the room. Try again.');
            setBusy(false);
        }
    };

    return (
        <Dialog open={open} onClose={close} maxWidth="xs" fullWidth aria-labelledby="room-privacy-title">
            <DialogTitle id="room-privacy-title">{confirm ? 'Delete the room for everyone?' : 'What the server keeps'}</DialogTitle>
            <DialogContent>
                {confirm ? (
                    <Typography variant="body2" data-testid="delete-room-warning">
                        All people leave the room. The server deletes the room, its photo list and its server copies.
                        The photos stay on the phones that have them.
                    </Typography>
                ) : (
                    <Box component="ul" data-testid="privacy-lines" sx={{ m: 0, pl: 2.5, display: 'flex', flexDirection: 'column', gap: 1 }}>
                        {privacyLines(readState(master)).map(line => (
                            <Typography component="li" variant="body2" key={line}>{line}</Typography>
                        ))}
                    </Box>
                )}
                {error && <Typography variant="body2" role="alert" sx={{ color: 'error.main', mt: 1.5 }}>{error}</Typography>}
            </DialogContent>
            <DialogActions sx={{ justifyContent: 'space-between' }}>
                {confirm ? (
                    <>
                        <Button onClick={() => setConfirm(false)} disabled={busy}>Cancel</Button>
                        <Button color="error" variant="contained" onClick={deleteRoom} disabled={busy}>Delete room</Button>
                    </>
                ) : (
                    <>
                        <Button color="error" onClick={() => setConfirm(true)}>Delete this room now</Button>
                        <Button variant="contained" onClick={close}>OK</Button>
                    </>
                )}
            </DialogActions>
        </Dialog>
    );
}

RoomPrivacy.propTypes = {
    master: PropTypes.object.isRequired,
    open: PropTypes.bool.isRequired,
    onClose: PropTypes.func.isRequired,
};
