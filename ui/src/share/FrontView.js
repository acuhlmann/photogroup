import React, { useState, useEffect, useCallback } from 'react';
import PropTypes from 'prop-types';

import Button from '@mui/material/Button';
import AddPhotoAlternateRounded from '@mui/icons-material/AddPhotoAlternateRounded';
import Typography from '@mui/material/Typography';
import CropFreeRounded from '@mui/icons-material/CropFreeRounded';
import Slide from '@mui/material/Slide';
import Box from '@mui/material/Box';
import Stack from '@mui/material/Stack';
import { keyframes } from '@mui/system';

const float = keyframes`
  0%, 100% { transform: translateY(0); }
  50% { transform: translateY(-8px); }
`;

const frames = [
    {
        title: 'Harbor',
        detail: '4.2 MB',
        wash: 'linear-gradient(145deg, #7dd3fc 0%, #0f766e 70%)',
        shift: -72,
        tilt: -8,
        delay: '0s',
        z: 1,
    },
    {
        title: 'Kitchen',
        detail: 'f/1.8 · 1/125',
        wash: 'linear-gradient(160deg, #fde68a 0%, #f97316 55%, #7c2d12 100%)',
        shift: 0,
        tilt: 2,
        delay: '0.4s',
        z: 2,
    },
    {
        title: 'Night bus',
        detail: '12:41 Oct 15',
        wash: 'linear-gradient(200deg, #c4b5fd 0%, #312e81 80%)',
        shift: 72,
        tilt: 8,
        delay: '0.8s',
        z: 1,
    },
];

function PhotoStack() {
    return (
        <Box
            aria-hidden="true"
            sx={{
                position: 'relative',
                width: 280,
                height: 168,
                mx: 'auto',
                my: 3,
            }}
        >
            {frames.map((frame) => (
                <Box
                    key={frame.title}
                    sx={{
                        position: 'absolute',
                        left: '50%',
                        top: 12,
                        width: 132,
                        ml: '-66px',
                        zIndex: frame.z,
                        animation: `${float} 5s ease-in-out ${frame.delay} infinite`,
                        '@media (prefers-reduced-motion: reduce)': {
                            animation: 'none',
                        },
                    }}
                >
                    <Box
                        sx={{
                            transform: `translateX(${frame.shift}px) rotate(${frame.tilt}deg)`,
                            borderRadius: 2,
                            overflow: 'hidden',
                            bgcolor: 'background.paper',
                            boxShadow: (theme) => theme.palette.mode === 'dark'
                                ? '0 12px 30px rgba(0,0,0,0.35)'
                                : '0 12px 30px rgba(15,23,42,0.12)',
                        }}
                    >
                        <Box sx={{ height: 78, background: frame.wash }} />
                        <Box sx={{ px: 1, py: 0.75, textAlign: 'left' }}>
                            <Typography variant="caption" sx={{ display: 'block', fontWeight: 700, color: 'text.primary', lineHeight: 1.2 }}>
                                {frame.title}
                            </Typography>
                            <Typography variant="caption" sx={{ color: 'text.secondary', fontSize: '0.65rem' }}>
                                {frame.detail}
                            </Typography>
                        </Box>
                    </Box>
                </Box>
            ))}
        </Box>
    );
}

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
        <Box
            sx={(theme) => ({
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'center',
                minHeight: 'calc(100vh - 64px)',
                width: '100%',
                px: { xs: 2, sm: 3 },
                py: { xs: 4, sm: 6 },
                '--dot-color': theme.palette.primary.main,
                color: theme.palette.text.secondary,
            })}
        >
            <Stack
                spacing={0}
                sx={{
                    alignItems: 'center',
                    width: '100%',
                    maxWidth: { xs: '100%', sm: 500 },
                    textAlign: 'center',
                }}
            >
                <Typography
                    variant="h3"
                    component="h1"
                    sx={{
                        fontWeight: 800,
                        letterSpacing: '-0.03em',
                        color: 'text.primary',
                        mb: 1,
                    }}
                >
                    Share the pictures
                </Typography>

                <Typography
                    variant="body1"
                    sx={{ color: 'text.secondary', maxWidth: 420 }}
                >
                    Pass them around with the camera details still attached, see how big they are, and save them on your phone.
                </Typography>

                <PhotoStack />

                <Stack spacing={1.5} sx={{ width: '100%', maxWidth: 320 }}>
                    <Button
                        onClick={openRoom}
                        variant="contained"
                        color="primary"
                        size="large"
                        fullWidth
                        startIcon={<AddPhotoAlternateRounded />}
                        sx={{ py: 1.5, fontSize: '1rem' }}
                    >
                        Create Room
                    </Button>
                    <Button
                        onClick={() => master.emitter.emit('openQr')}
                        variant="outlined"
                        fullWidth
                        size="large"
                        startIcon={<CropFreeRounded />}
                        sx={{ py: 1.3 }}
                    >
                        Scan QR to Join
                    </Button>
                </Stack>

                {/* Bottom caption */}
                <Typography
                    variant="body2"
                    sx={{
                        mt: 4,
                        color: 'text.secondary',
                        maxWidth: 380,
                    }}
                >
                    Pictures move straight from one person to another. The room shows how you're connected.
                </Typography>
            </Stack>
        </Box>
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
