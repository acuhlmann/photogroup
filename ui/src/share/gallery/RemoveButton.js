import React, { useState } from 'react';
import PropTypes from 'prop-types';
import IconButton from '@mui/material/IconButton';
import Button from '@mui/material/Button';
import Dialog from '@mui/material/Dialog';
import DialogTitle from '@mui/material/DialogTitle';
import DialogContent from '@mui/material/DialogContent';
import DialogContentText from '@mui/material/DialogContentText';
import DialogActions from '@mui/material/DialogActions';
import DeleteRounded from '@mui/icons-material/DeleteRounded';
import { removeLabel } from './removeLabel';

export const REMOVE_TITLE = 'Remove this photo for everyone?';
export const REMOVE_TEXT = 'It goes from the room for all people in it, and from the server. You cannot get it back here.';

/**
 * The trash button, the same in every mode. Remove takes the photo out of the
 * room for everyone, so it asks once before it does.
 */
export default function RemoveButton({ tile, onRemove, size, sx, iconSx }) {
    const [asking, setAsking] = useState(false);
    const confirm = () => {
        setAsking(false);
        onRemove(tile);
    };
    return (
        <>
            <IconButton aria-label={removeLabel(tile)} onClick={() => setAsking(true)} size={size} sx={sx}>
                <DeleteRounded fontSize={size === 'small' ? 'small' : 'medium'} sx={iconSx} />
            </IconButton>
            {asking && (
                <Dialog open onClose={() => setAsking(false)} aria-labelledby="remove-photo-title">
                    <DialogTitle id="remove-photo-title">{REMOVE_TITLE}</DialogTitle>
                    <DialogContent>
                        <DialogContentText>{REMOVE_TEXT}</DialogContentText>
                    </DialogContent>
                    <DialogActions>
                        <Button onClick={() => setAsking(false)}>Cancel</Button>
                        <Button color="error" variant="contained" onClick={confirm}>Remove</Button>
                    </DialogActions>
                </Dialog>
            )}
        </>
    );
}

RemoveButton.propTypes = {
    tile: PropTypes.object.isRequired,
    onRemove: PropTypes.func.isRequired,
    size: PropTypes.string,
    sx: PropTypes.object,
    iconSx: PropTypes.object,
};
