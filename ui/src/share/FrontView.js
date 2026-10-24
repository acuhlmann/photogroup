import React, { useState, useEffect, useCallback } from 'react';
import PropTypes from 'prop-types';

import Button from '@mui/material/Button';
import AddPhotoAlternateRounded from '@mui/icons-material/AddPhotoAlternateRounded';
import Typography from '@mui/material/Typography';
import CropFreeRounded from '@mui/icons-material/CropFreeRounded';
import Slide from '@mui/material/Slide';
import Box from '@mui/material/Box';
import Stack from '@mui/material/Stack';
import { createRoom } from './openRoom';

const frames = [
    {
        title: 'Harbor',
        detail: '4.2 MB',
        wash: 'linear-gradient(165deg, #16343c 0%, #0f766e 100%)',
        shift: -124,
        shiftXs: -98,
        tilt: -7,
        z: 1,
    },
    {
        title: 'Kitchen',
        detail: 'f/1.8 · 1/125',
        wash: 'linear-gradient(165deg, #3a291c 0%, #c2410c 100%)',
        shift: 0,
        shiftXs: 0,
        tilt: 1.5,
        z: 2,
    },
    {
        title: 'Night bus',
        detail: '12:41 Oct 15',
        wash: 'linear-gradient(195deg, #1e1b4b 0%, #312e81 100%)',
        shift: 124,
        shiftXs: 98,
        tilt: 7,
        z: 1,
    },
];

function PhotoStack() {
    return (
        <Box
            aria-hidden="true"
            sx={{
                position: 'relative',
                width: '100%',
                maxWidth: 440,
                height: { xs: 150, sm: 164 },
                mx: 'auto',
                my: { xs: 2, sm: 3 },
            }}
        >
            {frames.map((frame) => (
                <Box
                    key={frame.title}
                    sx={{
                        position: 'absolute',
                        left: '50%',
                        top: 8,
                        width: { xs: 104, sm: 132 },
                        ml: { xs: '-52px', sm: '-66px' },
                        zIndex: frame.z,
                    }}
                >
                    <Box
                        sx={{
                            transform: {
                                xs: `translateX(${frame.shiftXs}px) rotate(${frame.tilt}deg)`,
                                sm: `translateX(${frame.shift}px) rotate(${frame.tilt}deg)`,
                            },
                            borderRadius: 1.5,
                            overflow: 'hidden',
                            bgcolor: 'background.paper',
                            border: '1px solid',
                            borderColor: 'divider',
                            boxShadow: (theme) => theme.palette.mode === 'dark'
                                ? '0 16px 36px rgba(0,0,0,0.4)'
                                : '0 14px 28px rgba(20,24,32,0.1)',
                        }}
                    >
                        <Box sx={{ height: 72, background: frame.wash }} />
                        <Box sx={{ px: 1, py: 0.7, textAlign: 'left' }}>
                            <Typography variant="caption" sx={{ display: 'block', fontWeight: 600, color: 'text.primary', lineHeight: 1.2, letterSpacing: '-0.01em' }}>
                                {frame.title}
                            </Typography>
                            <Typography variant="caption" sx={{ color: 'text.secondary', fontSize: '0.65rem', fontFamily: 'var(--font-mono)' }}>
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
    // Switching modes mounts this after setup is done; master.me says it is.
    const [visible, setVisible] = useState(() => !!master.me);

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

    const openRoom = useCallback(() => createRoom(master), [master]);

    const hasRoom = () => {
        const urlParams = new URLSearchParams(window.location.search);
        return urlParams.has('room');
    };

    const buildView = () => (
        <Box
            sx={{
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'center',
                minHeight: 'calc(100vh - 72px)',
                width: '100%',
                px: { xs: 2, sm: 3 },
                py: { xs: 3, sm: 5 },
            }}
        >
            <Stack
                spacing={0}
                className="stage-panel glass"
                sx={{ alignItems: 'center' }}
            >
                <Typography className="eyebrow" sx={{ mb: 1.25 }}>
                    PhotoGroup
                </Typography>
                <Typography
                    variant="h3"
                    component="h1"
                    sx={{
                        fontWeight: 600,
                        color: 'text.primary',
                        fontSize: { xs: '2rem', sm: '2.5rem' },
                        mb: 1,
                    }}
                >
                    Share the pictures
                </Typography>

                <Typography
                    variant="body1"
                    sx={{ color: 'text.secondary', maxWidth: 420, lineHeight: 1.55 }}
                >
                    Share photos with all their camera details. See how big they are. Save them on your phone.
                </Typography>

                <PhotoStack />

                <Stack spacing={1.25} sx={{ width: '100%', maxWidth: 320 }}>
                    <Button
                        onClick={openRoom}
                        variant="contained"
                        color="primary"
                        size="large"
                        fullWidth
                        startIcon={<AddPhotoAlternateRounded />}
                        sx={{ py: 1.25, fontSize: '0.98rem' }}
                    >
                        Create Room
                    </Button>
                    <Button
                        onClick={() => master.emitter.emit('openQr')}
                        variant="outlined"
                        color="inherit"
                        fullWidth
                        size="large"
                        startIcon={<CropFreeRounded />}
                        sx={{ py: 1.15, color: 'text.primary' }}
                    >
                        Scan QR to Join
                    </Button>
                </Stack>

                <Box className="spec-row" aria-hidden="true">
                    <span>Direct</span>
                    <span>Original</span>
                    <span>No account</span>
                </Box>

                <Typography
                    variant="body2"
                    sx={{
                        mt: 2.5,
                        color: 'text.secondary',
                        maxWidth: 380,
                        lineHeight: 1.5,
                    }}
                >
                    Photos go directly from one person to another.
                </Typography>
            </Stack>
        </Box>
    );

    return (
        <Slide direction="up" in={!hasRoom() && visible} mountOnEnter unmountOnExit timeout={160}>
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
