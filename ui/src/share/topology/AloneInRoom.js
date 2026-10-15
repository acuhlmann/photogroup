import React from 'react';
import PropTypes from 'prop-types';
import Box from '@mui/material/Box';
import Stack from '@mui/material/Stack';
import Typography from '@mui/material/Typography';
import Button from '@mui/material/Button';
import IosShareRounded from '@mui/icons-material/IosShareRounded';

function AloneInRoom({ onInvite }) {
    return (
        <Box
            sx={{
                position: 'absolute',
                inset: 0,
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'center',
                px: 2,
                pointerEvents: 'none',
            }}
        >
            <Stack
                className="glass"
                spacing={1.25}
                sx={{
                    alignItems: 'center',
                    pointerEvents: 'auto',
                    textAlign: 'center',
                    maxWidth: 260,
                    px: 2,
                    py: 2,
                    borderRadius: 2,
                }}
            >
                <Typography variant="subtitle1" sx={{ fontWeight: 700 }}>
                    You're the only one here
                </Typography>
                <Typography variant="body2" sx={{ color: 'text.secondary' }}>
                    Invite someone. The line between you shows whether photos move directly, through a network, or over a relay.
                </Typography>
                <Button
                    variant="contained"
                    size="small"
                    startIcon={<IosShareRounded />}
                    onClick={onInvite}
                >
                    Invite someone
                </Button>
            </Stack>
        </Box>
    );
}

AloneInRoom.propTypes = {
    onInvite: PropTypes.func.isRequired,
};

export default AloneInRoom;
