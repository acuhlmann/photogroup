import React from 'react';
import PropTypes from 'prop-types';
import Box from '@mui/material/Box';
import IconButton from '@mui/material/IconButton';
import CloseRounded from '@mui/icons-material/CloseRounded';

import FileUtil from '../util/FileUtil';
import { ROUTE_STYLE } from './routeStyle';

const mono = 'var(--font-mono)';
const PART_RGB = { p2p: ROUTE_STYLE.lan.rgb, relay: ROUTE_STYLE.relay.rgb, server: ROUTE_STYLE.copies.rgb };

/**
 * The share in one card: photos, devices and the total time, how this
 * device's bytes went, and how long each device took. `onClose` makes it the
 * map's card; without it, it is the block at the top of Transfers.
 */
function SessionSummary({ summary, onClose }) {
    const card = !!onClose;
    return (
        <Box
            data-testid={card ? 'session-summary-card' : 'session-summary'}
            className={card ? 'glass' : undefined}
            sx={{
                fontFamily: mono, fontSize: '0.68rem', display: 'flex', flexDirection: 'column', gap: 0.5,
                ...(card
                    ? { p: 1.25, borderRadius: 2, border: 1, borderColor: 'divider', bgcolor: 'background.paper', boxShadow: 6, width: 300, maxWidth: 'calc(100% - 16px)' }
                    : { px: 1, py: 0.75, borderBottom: 1, borderColor: 'divider' }),
            }}
        >
            <Box sx={{ display: 'flex', alignItems: 'center', columnGap: 1, flexWrap: card ? 'nowrap' : 'wrap', minWidth: 0 }}>
                <Box component="span" sx={{ color: summary.done ? 'success.main' : 'text.disabled', letterSpacing: '0.06em', fontWeight: 700, flex: 'none' }}>
                    {summary.done ? 'SHARE DONE' : 'SHARE'}
                </Box>
                <Box component="span" sx={{ color: 'text.primary', fontWeight: 600, minWidth: 0 }}>{summary.headline}</Box>
                {card && (
                    <IconButton size="small" aria-label="Close the summary" onClick={onClose} sx={{ ml: 'auto', my: -0.75, mr: -0.75, flex: 'none' }}>
                        <CloseRounded fontSize="small" />
                    </IconButton>
                )}
            </Box>
            {summary.bytes.total > 0 && (
                <>
                    <Box sx={{ display: 'flex', height: 6, borderRadius: 1, overflow: 'hidden', bgcolor: 'action.hover' }}>
                        {summary.parts.filter(part => part.percent > 0).map(part => (
                            <Box key={part.kind} sx={{ width: `${part.percent}%`, bgcolor: `rgb(${PART_RGB[part.kind]})` }} />
                        ))}
                    </Box>
                    <Box sx={{ display: 'flex', flexWrap: 'wrap', columnGap: 1.25, fontSize: '0.62rem', color: 'text.secondary' }}>
                        <Box component="span" sx={{ color: 'text.disabled' }}>this device</Box>
                        {summary.parts.map(part => (
                            <Box component="span" key={part.kind} sx={{ display: 'inline-flex', alignItems: 'center', gap: 0.5 }}>
                                <Box component="span" sx={{ width: 7, height: 7, borderRadius: '50%', bgcolor: `rgb(${PART_RGB[part.kind]})` }} />
                                {`${part.label} ${part.percent}%`}
                            </Box>
                        ))}
                        <Box component="span">{`${FileUtil.formatBytes(summary.bytes.total)} moved`}</Box>
                    </Box>
                </>
            )}
            {summary.devices.length > 0 && (
                <Box sx={{ display: 'grid', gridTemplateColumns: 'minmax(0,auto) minmax(0,1fr)', columnGap: 1, rowGap: 0.25, fontSize: '0.62rem' }}>
                    {summary.devices.map(device => (
                        <React.Fragment key={device.peerId}>
                            <Box component="span" sx={{ color: 'text.primary', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap', maxWidth: '11rem' }}>
                                {device.name}
                            </Box>
                            <Box component="span" data-testid="device-times-row" sx={{ color: device.done ? 'text.secondary' : 'warning.main' }}>
                                {device.line || '…'}
                            </Box>
                        </React.Fragment>
                    ))}
                </Box>
            )}
        </Box>
    );
}

SessionSummary.propTypes = {
    summary: PropTypes.object.isRequired,
    onClose: PropTypes.func,
};

export default SessionSummary;
