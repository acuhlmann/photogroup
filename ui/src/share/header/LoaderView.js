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
    const stats = useRef({});
    // While the tooltip is open it shows the totals and speeds as they change.
    const tipOpen = useRef(false);

    useEffect(() => {
        const handleWtInitialized = (client) => {
            clearInterval(intervalRef.current);
            intervalRef.current = setInterval(() => {
                const progress = client.progress * 100;
                if (!(progress > 0 && progress < 100)) {
                    // The tooltip goes with the ring, without telling onClose.
                    tipOpen.current = false;
                    setTransfer(null);
                    return;
                }
                const torrents = client.torrents || [];
                const sum = key => torrents.reduce((total, torrent) => total + (torrent[key] || 0), 0);
                stats.current = {
                    down: FileUtil.formatBytes(sum('downloaded')),
                    up: FileUtil.formatBytes(sum('uploaded')),
                    downSpeed: FileUtil.formatBytes(client.downloadSpeed) + '/s',
                    upSpeed: FileUtil.formatBytes(client.uploadSpeed) + '/s',
                };
                // Five times a second: redraw the ring only when the whole
                // percent changes, and the tooltip only while it is open.
                const percent = Math.floor(progress);
                const { down, up, downSpeed, upSpeed } = stats.current;
                const text = tipOpen.current ? [down, up, downSpeed, upSpeed].join() : '';
                setTransfer(prev => (prev && prev.percent === percent && prev.text === text ? prev : { percent, text }));
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

    const { percent } = transfer;
    const { down, downSpeed, up, upSpeed } = stats.current;
    return (
        <Tooltip describeChild title={`↓ ${down} · ${downSpeed}   ↑ ${up} · ${upSpeed}`}
            onOpen={() => { tipOpen.current = true; }}
            onClose={() => { tipOpen.current = false; }}>
            <Box
                tabIndex={0}
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
                <CircularProgress variant="determinate" value={percent} size={16} thickness={5} />
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
