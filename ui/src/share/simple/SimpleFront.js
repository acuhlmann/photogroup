import React, { useState, useEffect } from 'react';
import PropTypes from 'prop-types';
import Box from '@mui/material/Box';
import Stack from '@mui/material/Stack';
import Button from '@mui/material/Button';
import Typography from '@mui/material/Typography';
import CircularProgress from '@mui/material/CircularProgress';
import PhotoCameraRounded from '@mui/icons-material/PhotoCameraRounded';
import QrCodeScannerRounded from '@mui/icons-material/QrCodeScannerRounded';

import { createRoom } from '../openRoom';

const STEPS = [
    'One person taps Start.',
    'Everyone else scans the code on that phone.',
    'Any photo someone adds lands on every phone.',
];

/** The simple landing page: start a group or join one, nothing else. */
function SimpleFront({ master }) {
    // master.me is set once the connection setup is done; until then a room can't be made.
    const [ready, setReady] = useState(() => !!master.me);
    const [starting, setStarting] = useState(false);

    useEffect(() => {
        const handleReady = () => setReady(true);
        master.emitter.on('addPeerDone', handleReady);
        return () => master.emitter.removeListener('addPeerDone', handleReady);
    }, [master.emitter]);

    const start = async () => {
        setStarting(true);
        try {
            await createRoom(master);
        } finally {
            setStarting(false);
        }
    };

    return (
        <Box sx={{
            minHeight: 'calc(100vh - 96px)',
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
            px: 2,
            py: 4,
        }}>
            <Stack spacing={3} sx={{ width: '100%', maxWidth: 420, textAlign: 'center' }}>
                <Box>
                    <Typography variant="h4" component="h1" sx={{ fontWeight: 700, mb: 1, fontSize: { xs: '1.9rem', sm: '2.2rem' } }}>
                        Swap photos with the people around you
                    </Typography>
                    <Typography variant="body1" sx={{ color: 'text.secondary', fontSize: '1.05rem' }}>
                        No app, no account, no social media.
                    </Typography>
                </Box>

                <Stack spacing={1.5}>
                    <Button
                        variant="contained"
                        size="large"
                        disabled={!ready || starting}
                        onClick={start}
                        startIcon={starting || !ready ? <CircularProgress size={20} color="inherit" /> : <PhotoCameraRounded />}
                        sx={{ py: 2, fontSize: '1.2rem', fontWeight: 700, textTransform: 'none', borderRadius: 3 }}
                    >
                        {ready ? 'Start' : 'Getting ready…'}
                    </Button>
                    <Button
                        variant="outlined"
                        size="large"
                        color="inherit"
                        onClick={() => master.emitter.emit('openQr')}
                        startIcon={<QrCodeScannerRounded />}
                        sx={{ py: 2, fontSize: '1.2rem', fontWeight: 700, textTransform: 'none', borderRadius: 3 }}
                    >
                        Scan to join
                    </Button>
                </Stack>

                <Box component="ol" sx={{ m: 0, p: 0, listStyle: 'none', textAlign: 'left' }}>
                    {STEPS.map((step, index) => (
                        <Stack component="li" key={step} direction="row" spacing={1.5} sx={{ alignItems: 'center', py: 0.75 }}>
                            <Box sx={{
                                width: 28, height: 28, flexShrink: 0, borderRadius: '50%',
                                display: 'flex', alignItems: 'center', justifyContent: 'center',
                                bgcolor: 'var(--accent-soft)', color: 'primary.main', fontWeight: 700,
                            }}>
                                {index + 1}
                            </Box>
                            <Typography variant="body1">{step}</Typography>
                        </Stack>
                    ))}
                </Box>
            </Stack>
        </Box>
    );
}

SimpleFront.propTypes = {
    master: PropTypes.object.isRequired,
};

export default SimpleFront;
