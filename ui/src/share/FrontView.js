import React, { useState, useEffect, useCallback } from 'react';
import PropTypes from 'prop-types';

import Button from '@mui/material/Button';
import PlayCircleFilledWhiteRoundedIcon from '@mui/icons-material/PlayCircleFilledWhiteRounded';
import Typography from '@mui/material/Typography';
import CropFreeRounded from '@mui/icons-material/CropFreeRounded';
import IconButton from '@mui/material/IconButton';
import Slide from '@mui/material/Slide';
import Paper from '@mui/material/Paper';
import Stack from '@mui/material/Stack';

function FrontView({ master }) {
    const [visible, setVisible] = useState(false);

    useEffect(() => {
        const handleHideFrontView = () => {
            setVisible(false);
        };
        const handleIceDone = () => {
            setVisible(true);
        };

        master.emitter.on('hideFrontView', handleHideFrontView);
        master.emitter.on('iceDone', handleIceDone);

        return () => {
            master.emitter.removeListener('hideFrontView', handleHideFrontView);
            master.emitter.removeListener('iceDone', handleIceDone);
        };
    }, [master.emitter]);

    const openRoom = useCallback(async () => {
        master.emitter.emit('openRoomStart');

        try {
            await master.findExistingContent(master.service.createRoom, true);
            master.service.changeUrl('room', master.service.id);

            master.emitter.emit('openRoomEnd');
            master.emitter.emit('readyToUpload');
        } catch (error) {
            console.error('Failed to create room:', error);
            master.emitter.emit('roomCreationError', error);
            master.emitter.emit('openRoomEnd');

            if (error.message && error.message.includes('Failed to fetch') || error.message.includes('NetworkError')) {
                master.emitter.emit('showError', 'Cannot connect to server. Please make sure the backend server is running on port 8081.');
            } else {
                master.emitter.emit('showError', `Failed to create room: ${error.message || 'Unknown error'}`);
            }
        }
    }, [master]);

    const hasRoom = () => {
        const urlParams = new URLSearchParams(window.location.search);
        return urlParams.has('room');
    };

    const buildView = () => (
        <Stack alignItems="center" sx={{ mt: { xs: 3, sm: 5 }, width: '100%' }}>
            <Paper
                elevation={0}
                sx={(theme) => ({
                    p: { xs: 2.5, sm: 3 },
                    maxWidth: 440,
                    width: '100%',
                    border: `1px solid ${theme.palette.divider}`,
                    borderRadius: 2,
                    bgcolor: 'background.paper',
                })}
            >
                <Stack spacing={2} alignItems="stretch">
                    <Typography variant="subtitle1" component="h2" fontWeight={600} textAlign="center">
                        Start or join a room
                    </Typography>
                    <Typography variant="body2" color="text.secondary" textAlign="center">
                        One peer creates the room; others join with a link or QR code.
                    </Typography>
                    <Button
                        onClick={openRoom}
                        variant="contained"
                        color="primary"
                        fullWidth
                        size="large"
                        endIcon={<PlayCircleFilledWhiteRoundedIcon />}
                    >
                        Start a private room
                    </Button>
                    <Stack direction="row" alignItems="center" justifyContent="center" spacing={1} flexWrap="wrap">
                        <Typography variant="body2" color="text.secondary">
                            Or scan a QR code to join
                        </Typography>
                        <IconButton
                            onClick={() => master.emitter.emit('openQr')}
                            color="primary"
                            aria-label="Scan QR code to join"
                        >
                            <CropFreeRounded />
                        </IconButton>
                    </Stack>
                </Stack>
            </Paper>
        </Stack>
    );

    return (
        <Slide direction="up" in={!hasRoom() && visible} mountOnEnter unmountOnExit>
            <div>
                {buildView()}
            </div>
        </Slide>
    );
}

FrontView.propTypes = {
    master: PropTypes.object.isRequired,
};

export default FrontView;
