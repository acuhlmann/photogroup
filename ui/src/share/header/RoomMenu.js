import React, { useState } from 'react';
import PropTypes from 'prop-types';
import Logger from 'js-logger';

import ButtonBase from '@mui/material/ButtonBase';
import Box from '@mui/material/Box';
import Menu from '@mui/material/Menu';
import MenuItem from '@mui/material/MenuItem';
import Divider from '@mui/material/Divider';
import ListItemIcon from '@mui/material/ListItemIcon';
import ListItemText from '@mui/material/ListItemText';
import Dialog from '@mui/material/Dialog';
import DialogTitle from '@mui/material/DialogTitle';
import DialogContent from '@mui/material/DialogContent';
import DialogActions from '@mui/material/DialogActions';
import TextField from '@mui/material/TextField';
import Button from '@mui/material/Button';
import ExpandMoreRounded from '@mui/icons-material/ExpandMoreRounded';
import EditRounded from '@mui/icons-material/EditRounded';
import ShieldOutlined from '@mui/icons-material/ShieldOutlined';
import LogoutRounded from '@mui/icons-material/LogoutRounded';
import LockRounded from '@mui/icons-material/LockRounded';

import RoomPrivacy from '../RoomPrivacy';
import { leaveRoomNotice } from '../roomNotice';
import { dropRoomSubscription } from '../pushNotices';
import { roomCryptoKey } from '../privateRoom';
import { sealText } from '../security/roomKey';

export const ROOM_NAME_MAX = 60;
const GO_BACK = 'To go back, open it under Your rooms.';
export const LEFT_ROOM = 'You left the room. ' + GO_BACK;

/** Give the room a name everyone in it sees, or clear it. */
function RoomNameDialog({ master, open, name, onClose }) {
    const [value, setValue] = useState(name);
    const [busy, setBusy] = useState(false);
    const [error, setError] = useState('');

    const save = async (event) => {
        event.preventDefault();
        setBusy(true);
        setError('');
        try {
            // A private room's name is sealed, so the server can't read it.
            const key = await roomCryptoKey();
            const plain = value.trim();
            const sealed = key && plain ? await sealText(key, plain) : plain;
            const settings = await master.service.updateRoomSettings({ name: sealed });
            master.emitter.emit('roomSettings', settings);
            onClose();
        } catch (err) {
            Logger.warn('room name: ' + err);
            setError('Could not change the name. Try again.');
        } finally {
            setBusy(false);
        }
    };

    return (
        <Dialog open={open} onClose={onClose} maxWidth="xs" fullWidth aria-labelledby="room-name-title"
            slotProps={{ transition: { onEnter: () => { setValue(name); setError(''); } } }}>
            <form onSubmit={save}>
                <DialogTitle id="room-name-title">Name the room</DialogTitle>
                <DialogContent>
                    <TextField
                        autoFocus
                        fullWidth
                        margin="dense"
                        label="Room name"
                        placeholder="For example: Anna's birthday"
                        value={value}
                        onChange={event => setValue(event.target.value)}
                        slotProps={{ htmlInput: { maxLength: ROOM_NAME_MAX } }}
                        error={!!error}
                        helperText={error || 'All people in the room see this name.'}
                    />
                </DialogContent>
                <DialogActions>
                    <Button onClick={onClose} disabled={busy}>Cancel</Button>
                    <Button type="submit" variant="contained" disabled={busy}>Save</Button>
                </DialogActions>
            </form>
        </Dialog>
    );
}

RoomNameDialog.propTypes = {
    master: PropTypes.object.isRequired,
    open: PropTypes.bool.isRequired,
    name: PropTypes.string.isRequired,
    onClose: PropTypes.func.isRequired,
};

/**
 * The room's name at the top of the page, in every mode. It opens the
 * things you do to the room itself: name it, see what the server keeps,
 * and leave it.
 */
export default function RoomMenu({ master, name, label, isPrivate = false, missingKey = false }) {
    const [anchor, setAnchor] = useState(null);
    const [naming, setNaming] = useState(false);
    const [privacy, setPrivacy] = useState(false);

    const pick = (action) => () => {
        setAnchor(null);
        action();
    };

    const leave = async () => {
        leaveRoomNotice(LEFT_ROOM);
        // Off this room's list first: a person who left should not be told
        // about the photos others go on adding to it. Awaited, because the
        // reload that follows would otherwise cut the request off.
        await dropRoomSubscription({ service: master.service });
        master.leaveRoomAndReload();
    };

    return (
        <>
            <ButtonBase
                aria-label={`Room: ${label}. Room menu`}
                aria-haspopup="menu"
                aria-expanded={anchor ? 'true' : undefined}
                onClick={event => setAnchor(event.currentTarget)}
                sx={{
                    minWidth: 0,
                    maxWidth: '100%',
                    gap: 0.25,
                    px: 0.75,
                    ml: -0.75,
                    py: 0.25,
                    borderRadius: '6px',
                    justifyContent: 'flex-start',
                    color: name ? 'text.primary' : 'text.secondary',
                    '&:hover': { backgroundColor: 'var(--accent-soft)' },
                }}
            >
                <Box component="span" sx={{
                    overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap',
                    fontWeight: 600, fontSize: { xs: '0.98rem', sm: '0.85rem' }, lineHeight: 1.25,
                }}>
                    {label}
                </Box>
                {isPrivate && <LockRounded aria-label="Private room" sx={{ fontSize: 15, flexShrink: 0, ml: 0.25 }} />}
                <ExpandMoreRounded sx={{ fontSize: 18, flexShrink: 0 }} />
            </ButtonBase>
            <Menu anchorEl={anchor} open={!!anchor} onClose={() => setAnchor(null)}>
                <MenuItem onClick={pick(() => setNaming(true))} disabled={missingKey}>
                    <ListItemIcon><EditRounded fontSize="small" /></ListItemIcon>
                    <ListItemText primary={name ? 'Change the name' : 'Name the room'} />
                </MenuItem>
                <MenuItem onClick={pick(() => setPrivacy(true))}>
                    <ListItemIcon><ShieldOutlined fontSize="small" /></ListItemIcon>
                    <ListItemText primary="Privacy" />
                </MenuItem>
                <Divider />
                <MenuItem onClick={pick(leave)}>
                    <ListItemIcon><LogoutRounded fontSize="small" /></ListItemIcon>
                    <ListItemText primary="Leave the room" secondary={GO_BACK} />
                </MenuItem>
            </Menu>
            <RoomNameDialog master={master} open={naming} name={name} onClose={() => setNaming(false)} />
            <RoomPrivacy master={master} open={privacy} onClose={() => setPrivacy(false)} />
        </>
    );
}

RoomMenu.propTypes = {
    master: PropTypes.object.isRequired,
    name: PropTypes.string.isRequired,
    label: PropTypes.string.isRequired,
    isPrivate: PropTypes.bool,
    missingKey: PropTypes.bool,
};
