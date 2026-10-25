import React, { useState, useEffect } from 'react';
import PropTypes from 'prop-types';
import Stack from '@mui/material/Stack';
import Button from '@mui/material/Button';
import Typography from '@mui/material/Typography';
import Collapse from '@mui/material/Collapse';
import AddAPhotoRounded from '@mui/icons-material/AddAPhotoRounded';
import QrCode2Rounded from '@mui/icons-material/QrCode2Rounded';
import { CLIP_SIZE_NOTE } from '../torrent/ServerCopyLimits';
import InviteCode from '../InviteCode';

function peopleLabel(count) {
    if (count <= 1) return 'Just you so far';
    return `${count} people here`;
}

/**
 * The top of a room in simple mode: the code others scan to join, how many
 * are here, and one big button to add photos and clips (it opens the
 * header's file input). Leaving and naming the room are in the room menu at the top.
 */
function SimpleRoomBar({ master, roomName = '' }) {
    const [count, setCount] = useState(() => master.peers?.items?.length || 1);
    const [showCode, setShowCode] = useState(false);
    const alone = count <= 1;

    useEffect(() => {
        const handleCount = numPeers => setCount(numPeers);
        master.emitter.on('numPeersChange', handleCount);
        return () => master.emitter.removeListener('numPeersChange', handleCount);
    }, [master.emitter]);

    return (
        <Stack spacing={2} sx={{ mb: 3, maxWidth: 560, mx: 'auto', width: '100%' }}>
            <Collapse in={alone || showCode}>
                <Stack spacing={1.5} sx={{
                    alignItems: 'center',
                    textAlign: 'center',
                    p: 2.5,
                    borderRadius: 3,
                    border: 1,
                    borderColor: 'divider',
                    bgcolor: 'background.paper',
                }}>
                    <Typography variant="h6" component="h2" sx={{ fontWeight: 700 }}>
                        Let the people next to you scan this
                    </Typography>
                    <InviteCode master={master} roomName={roomName} />
                </Stack>
            </Collapse>

            <Stack direction="row" spacing={1} sx={{ alignItems: 'center' }}>
                <Typography variant="body1" role="status" sx={{ flex: 1, fontWeight: 600 }}>
                    {peopleLabel(count)}
                </Typography>
                {!alone && (
                    <Button variant="outlined" color="inherit" startIcon={<QrCode2Rounded />}
                        onClick={() => setShowCode(value => !value)} sx={{ textTransform: 'none' }}>
                        {showCode ? 'Hide code' : 'Invite'}
                    </Button>
                )}
            </Stack>

            <Button
                component="label"
                htmlFor="contained-button-file"
                variant="contained"
                size="large"
                startIcon={<AddAPhotoRounded />}
                sx={{ py: 2, fontSize: '1.2rem', fontWeight: 700, textTransform: 'none', borderRadius: 3 }}
            >
                Add photos and clips
            </Button>
            <Typography variant="body2" sx={{ color: 'text.secondary', textAlign: 'center', mt: '8px !important' }}>
                {CLIP_SIZE_NOTE}
            </Typography>
        </Stack>
    );
}

SimpleRoomBar.propTypes = {
    master: PropTypes.object.isRequired,
    roomName: PropTypes.string,
};

export default SimpleRoomBar;
