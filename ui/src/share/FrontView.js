import React, { useState, useEffect, useCallback } from 'react';
import PropTypes from 'prop-types';

import Button from '@mui/material/Button';
import PlayCircleFilledWhiteRoundedIcon from '@mui/icons-material/PlayCircleFilledWhiteRounded';
import Typography from '@mui/material/Typography';
import CropFreeRounded from '@mui/icons-material/CropFreeRounded';
import Slide from '@mui/material/Slide';
import Box from '@mui/material/Box';
import Stack from '@mui/material/Stack';
import { keyframes } from '@mui/system';

const travel1 = keyframes`
  0%   { offset-distance: 0%; opacity: 0; }
  10%  { opacity: 1; }
  90%  { opacity: 1; }
  100% { offset-distance: 100%; opacity: 0; }
`;

const travel2 = keyframes`
  0%   { offset-distance: 0%; opacity: 0; }
  10%  { opacity: 1; }
  90%  { opacity: 1; }
  100% { offset-distance: 100%; opacity: 0; }
`;

const pulse = keyframes`
  0%, 100% { transform: scale(1); opacity: 0.7; }
  50%      { transform: scale(1.3); opacity: 1; }
`;

function NetworkIllustration() {
    // Three nodes in a triangle, with animated dots traveling along the edges
    const nodes = [
        { cx: 60, cy: 20 },   // top
        { cx: 20, cy: 80 },   // bottom-left
        { cx: 100, cy: 80 },  // bottom-right
    ];
    const lines = [
        { x1: 60, y1: 20, x2: 20, y2: 80 },
        { x1: 20, y1: 80, x2: 100, y2: 80 },
        { x1: 100, y1: 80, x2: 60, y2: 20 },
    ];

    return (
        <Box sx={{ width: 120, height: 100, position: 'relative', mx: 'auto', my: 2 }}>
            <svg
                viewBox="0 0 120 100"
                width="120"
                height="100"
                style={{ display: 'block' }}
            >
                {/* Lines */}
                {lines.map((l, i) => (
                    <line
                        key={`line-${i}`}
                        x1={l.x1} y1={l.y1} x2={l.x2} y2={l.y2}
                        stroke="currentColor"
                        strokeOpacity={0.2}
                        strokeWidth={1}
                    />
                ))}
                {/* Traveling dots along each line */}
                {lines.map((l, i) => (
                    <circle
                        key={`dot-${i}`}
                        r="2.5"
                        fill="var(--dot-color, #00e5ff)"
                        style={{
                            offsetPath: `path("M${l.x1},${l.y1} L${l.x2},${l.y2}")`,
                            animation: `${i % 2 === 0 ? travel1 : travel2} ${2 + i * 0.6}s ease-in-out ${i * 0.7}s infinite`,
                        }}
                    />
                ))}
                {/* Node circles */}
                {nodes.map((n, i) => (
                    <circle
                        key={`node-${i}`}
                        cx={n.cx} cy={n.cy} r="5"
                        fill="currentColor"
                        opacity={0.6}
                        style={{
                            animation: `${pulse} ${3 + i * 0.4}s ease-in-out ${i * 0.5}s infinite`,
                            transformOrigin: `${n.cx}px ${n.cy}px`,
                        }}
                    />
                ))}
            </svg>
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
                alignItems="center"
                spacing={0}
                sx={{
                    width: '100%',
                    maxWidth: { xs: '100%', sm: 500 },
                    textAlign: 'center',
                }}
            >
                {/* Title */}
                <Typography
                    variant="h3"
                    component="h1"
                    sx={{
                        fontWeight: 800,
                        letterSpacing: '-0.02em',
                        color: 'text.primary',
                        mb: 1,
                    }}
                >
                    PhotoGroup
                </Typography>

                {/* Tagline */}
                <Typography
                    variant="body2"
                    sx={{ color: 'text.secondary', mb: 3 }}
                >
                    Zero Install, Peer-to-Peer Photo Collaboration
                </Typography>

                {/* Network illustration */}
                <NetworkIllustration />

                {/* Action buttons */}
                <Stack spacing={1.5} sx={{ width: '100%', maxWidth: 320, mt: 3 }}>
                    <Button
                        onClick={openRoom}
                        variant="contained"
                        color="primary"
                        size="large"
                        fullWidth
                        startIcon={<PlayCircleFilledWhiteRoundedIcon />}
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
                    variant="caption"
                    sx={{
                        mt: 6,
                        fontFamily: 'var(--font-mono)',
                        color: 'text.secondary',
                        opacity: 0.7,
                        fontSize: '0.7rem',
                    }}
                >
                    Photos transfer directly between browsers via WebRTC
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
