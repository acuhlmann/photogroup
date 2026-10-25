import React, { useState } from 'react';
import PropTypes from 'prop-types';
import { formatDistanceToNow } from 'date-fns';
import Box from '@mui/material/Box';
import Stack from '@mui/material/Stack';
import Typography from '@mui/material/Typography';
import ButtonBase from '@mui/material/ButtonBase';
import IconButton from '@mui/material/IconButton';
import CloseRounded from '@mui/icons-material/CloseRounded';
import ChevronRightRounded from '@mui/icons-material/ChevronRightRounded';
import { forgetRoom, listRooms, roomLabel } from './recentRooms';
import { keyHash } from './privateRoom';

export function openRoomLink(room) {
    return window.location.pathname + '?room=' + encodeURIComponent(room.id) + keyHash(room.key);
}

/**
 * "Your rooms" on the front page: the rooms this browser opened, so people
 * can go back to one. Nothing shows until there is a room to go back to.
 */
export default function RecentRooms({ now = Date.now() }) {
    const [rooms, setRooms] = useState(listRooms);
    if (!rooms.length) return null;

    const forget = (id) => {
        forgetRoom(id);
        setRooms(listRooms());
    };

    return (
        <Box component="section" aria-labelledby="your-rooms" sx={{ width: '100%', textAlign: 'left' }}>
            <Typography id="your-rooms" variant="subtitle2" component="h2" sx={{ color: 'text.secondary', mb: 1 }}>
                Your rooms
            </Typography>
            <Stack component="ul" spacing={1} sx={{ m: 0, p: 0, listStyle: 'none' }}>
                {rooms.map(room => (
                    <Stack component="li" key={room.id} direction="row" sx={{
                        alignItems: 'center',
                        border: 1,
                        borderColor: 'divider',
                        borderRadius: 2,
                        bgcolor: 'background.paper',
                        overflow: 'hidden',
                    }}>
                        <ButtonBase
                            component="a"
                            href={openRoomLink(room)}
                            sx={{ flex: 1, minWidth: 0, justifyContent: 'flex-start', gap: 1, px: 1.75, py: 1.25, textAlign: 'left' }}
                        >
                            <Box sx={{ flex: 1, minWidth: 0 }}>
                                <Typography variant="body1" sx={{ fontWeight: 600, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                                    {roomLabel(room)}
                                </Typography>
                                {room.lastSeen ? (
                                    <Typography variant="caption" sx={{ color: 'text.secondary' }}>
                                        Opened {formatDistanceToNow(Math.min(room.lastSeen, now))} ago
                                    </Typography>
                                ) : null}
                            </Box>
                            <ChevronRightRounded sx={{ color: 'text.secondary' }} />
                        </ButtonBase>
                        <IconButton aria-label={`Remove ${roomLabel(room)} from this list`} onClick={() => forget(room.id)}
                            sx={{ mr: 0.5, color: 'text.secondary' }}>
                            <CloseRounded fontSize="small" />
                        </IconButton>
                    </Stack>
                ))}
            </Stack>
        </Box>
    );
}

RecentRooms.propTypes = {
    now: PropTypes.number,
};
