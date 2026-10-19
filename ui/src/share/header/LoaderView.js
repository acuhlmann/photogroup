import React, { useState, useEffect, useRef } from 'react';
import PropTypes from 'prop-types';
import Box from '@mui/material/Box';
import Tooltip from '@mui/material/Tooltip';
import CircularProgress from '@mui/material/CircularProgress';
import FileUtil from '../util/FileUtil';
import { headerLabelSx } from './headerButtonSx';

/**
 * Compact transfer readout for the header: a small ring and percentage while
 * any torrent is moving, with totals and speeds on hover. Hidden when idle;
 * the status bar below the header carries the steady-state speeds.
 */
function LoaderView({emitter}) {
    const [transfer, setTransfer] = useState(null);
    const intervalRef = useRef(null);

    useEffect(() => {
        const handleWtInitialized = (client) => {
            clearInterval(intervalRef.current);
            intervalRef.current = setInterval(() => {
                const progress = client.progress * 100;
                if (!(progress > 0 && progress < 100)) {
                    setTransfer(null);
                    return;
                }
                const torrents = client.torrents || [];
                const sum = key => torrents.reduce((total, torrent) => total + (torrent[key] || 0), 0);
                setTransfer({
                    progress,
                    down: FileUtil.formatBytes(sum('downloaded')),
                    up: FileUtil.formatBytes(sum('uploaded')),
                    downSpeed: FileUtil.formatBytes(client.downloadSpeed) + '/s',
                    upSpeed: FileUtil.formatBytes(client.uploadSpeed) + '/s',
                });
            }, 200);
        };

        emitter.on('wtInitialized', handleWtInitialized);

        return () => {
            emitter.removeListener('wtInitialized', handleWtInitialized);
            clearInterval(intervalRef.current);
        };
    }, [emitter]);

    if (!transfer) {
        return null;
    }

    const percent = Math.floor(transfer.progress);
    return (
        <Tooltip title={`↓ ${transfer.down} · ${transfer.downSpeed}   ↑ ${transfer.up} · ${transfer.upSpeed}`}>
            <Box
                role="progressbar"
                aria-label="Transfer progress"
                aria-valuenow={percent}
                aria-valuemin={0}
                aria-valuemax={100}
                sx={{
                    display: 'flex',
                    alignItems: 'center',
                    gap: 0.75,
                    height: 34,
                    px: 1,
                    borderRadius: '8px',
                    border: '1px solid',
                    borderColor: 'divider',
                    color: 'text.secondary',
                }}
            >
                <CircularProgress variant="determinate" value={transfer.progress} size={16} thickness={5} />
                <Box component="span" sx={{ ...headerLabelSx, minWidth: '3ch', fontVariantNumeric: 'tabular-nums' }}>
                    {percent}%
                </Box>
            </Box>
        </Tooltip>
    );
}

LoaderView.propTypes = {
    emitter: PropTypes.object.isRequired,
};

export default LoaderView;
