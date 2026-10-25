import React, { useState } from 'react';
import Box from '@mui/material/Box';
import Switch from '@mui/material/Switch';
import FormControlLabel from '@mui/material/FormControlLabel';
import Typography from '@mui/material/Typography';
import { setWantsPrivateRooms, wantsPrivateRooms } from './privateRoom';

export const PRIVATE_ROOM_TEXT = 'Each phone encrypts the photos and their names with a key in the room link. '
    + 'The server cannot read them. You cannot share titles, ratings or places.';

/** Next to "Start a room": the next room that you start is private. Off until the person turns it on. */
export default function PrivateRoomSwitch() {
    const [checked, setChecked] = useState(wantsPrivateRooms);
    const change = event => {
        setWantsPrivateRooms(event.target.checked);
        setChecked(event.target.checked);
    };

    return (
        <FormControlLabel
            control={<Switch checked={checked} onChange={change} color="primary" />}
            label={
                <Box>
                    <Typography variant="body2" sx={{ fontWeight: 600 }}>Private room</Typography>
                    <Typography variant="caption" component="div" sx={{ color: 'text.secondary', lineHeight: 1.4 }}>
                        {PRIVATE_ROOM_TEXT}
                    </Typography>
                </Box>
            }
            sx={{ alignItems: 'flex-start', textAlign: 'left', mx: 0, '& .MuiSwitch-root': { mt: -0.5 } }}
        />
    );
}
