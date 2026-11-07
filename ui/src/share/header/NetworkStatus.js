import React, { useEffect, useState } from 'react';
import PropTypes from 'prop-types';
import Box from '@mui/material/Box';
import Chip from '@mui/material/Chip';
import Typography from '@mui/material/Typography';

const speedSx = { fontFamily: 'var(--font-mono)', fontSize: '0.68rem', color: 'text.secondary' };

/** Keep `prev` when nothing changed, so React skips the redraw. */
const withValue = (key, value) => prev => (prev[key] === value ? prev : { ...prev, [key]: value });

/**
 * The line under the header with the number of peers and the speeds. It
 * listens to the transfer events itself: they come up to five times a
 * second per photo, and kept in App they redrew the whole app each time.
 */
function NetworkStatus({ emitter, peers = null }) {
    // The peers already here (they may have come while another mode showed).
    const [status, setStatus] = useState(() => ({ peers: peers?.items?.length || 0, downSpeed: '', upSpeed: '' }));
    useEffect(() => {
        const onPeers = numPeers => setStatus(withValue('peers', numPeers));
        const onDown = event => setStatus(withValue('downSpeed', event.speed || ''));
        const onUp = event => setStatus(withValue('upSpeed', event.speed || ''));
        emitter.on('numPeersChange', onPeers);
        // One may have come between the first draw and now.
        if (peers?.items) onPeers(peers.items.length);
        emitter.on('downloadProgress', onDown);
        emitter.on('uploadProgress', onUp);
        return () => {
            emitter.removeListener('numPeersChange', onPeers);
            emitter.removeListener('downloadProgress', onDown);
            emitter.removeListener('uploadProgress', onUp);
        };
    }, [emitter, peers]);

    if (!(status.peers > 0 || status.downSpeed || status.upSpeed)) return null;
    return (
        <Box
            className="telemetry"
            sx={{
                display: 'flex',
                alignItems: 'center',
                gap: 1.5,
                px: 2,
                py: 0.4,
                borderTop: 1,
                borderColor: 'divider',
                color: 'text.secondary',
            }}
        >
            <Box className="live-dot" aria-hidden="true" />
            {status.peers > 0 && (
                <Chip
                    size="small"
                    label={`${status.peers} peer${status.peers !== 1 ? 's' : ''}`}
                    variant="outlined"
                    sx={{
                        height: 20,
                        borderColor: 'divider',
                        color: 'text.secondary',
                        '& .MuiChip-label': { px: 1 },
                    }}
                />
            )}
            {status.downSpeed && <Typography variant="caption" sx={speedSx}>↓ {status.downSpeed}</Typography>}
            {status.upSpeed && <Typography variant="caption" sx={speedSx}>↑ {status.upSpeed}</Typography>}
        </Box>
    );
}

NetworkStatus.propTypes = {
    emitter: PropTypes.object.isRequired,
    peers: PropTypes.object,
};

export default NetworkStatus;
