import React from 'react';
import PropTypes from 'prop-types';
import Box from '@mui/material/Box';
import Typography from '@mui/material/Typography';

import FileUtil from '../util/FileUtil';
import { formatDuration } from './transfers';
import { ROUTE_STYLE } from './routeStyle';

const mono = 'var(--font-mono)';

const clockTime = at => new Date(at).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
// An expiry is often tomorrow: say which day when it is not today.
const dayTime = at => (new Date(at).toDateString() === new Date().toDateString()
    ? clockTime(at)
    : new Date(at).toLocaleString([], { weekday: 'short', hour: '2-digit', minute: '2-digit' }));
const COPY_COLOR = { stored: `rgb(${ROUTE_STYLE.copies.rgb})`, uploading: 'warning.main', requested: 'text.disabled' };

/**
 * What sits on photogroup.network right now, for the whole room: each copy,
 * who sent it, how much of it has arrived, when, and when it will be gone.
 */
function ServerCopies({ copies }) {
    return (
        <Box data-testid="server-copies" sx={{ fontFamily: mono, fontSize: '0.68rem', px: 1, py: 0.75, borderBottom: 1, borderColor: 'divider', display: 'flex', flexDirection: 'column', gap: 0.6 }}>
            <Box sx={{ display: 'flex', alignItems: 'baseline', gap: 1, flexWrap: 'wrap' }}>
                <Box component="span" sx={{ color: 'text.disabled', letterSpacing: '0.06em' }}>ON THE SERVER</Box>
                <Box component="span" sx={{ color: 'text.secondary' }}>
                    {copies.length
                        ? `${copies.length} ${copies.length === 1 ? 'copy' : 'copies'} in this room`
                        : 'nothing now · a copy is deleted once everyone has the photo'}
                </Box>
            </Box>
            {copies.map(copy => (
                <Box key={copy.infoHash} data-testid="server-copy" sx={{ display: 'flex', flexDirection: 'column', gap: 0.3 }}>
                    <Box sx={{ display: 'flex', alignItems: 'baseline', columnGap: 1, flexWrap: 'wrap', minWidth: 0 }}>
                        <Box component="span" sx={{ fontWeight: 600, color: 'text.primary', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap', minWidth: 0, maxWidth: '100%' }}>
                            {copy.name}
                        </Box>
                        <Box component="span" sx={{ color: COPY_COLOR[copy.state] }}>
                            {copy.state === 'uploading' ? `uploading ${copy.percent}%` : copy.state}
                        </Box>
                        <Box component="span" sx={{ color: 'text.disabled' }}>
                            {[copy.size ? (copy.state === 'uploading'
                                ? `${FileUtil.formatBytes(copy.received)}/${FileUtil.formatBytes(copy.size)}`
                                : FileUtil.formatBytes(copy.size)) : null,
                            copy.from ? `from ${copy.from}` : null,
                            copy.startedAt ? `started ${clockTime(copy.startedAt)}` : null,
                            copy.storedAt ? `stored ${clockTime(copy.storedAt)}` : null].filter(Boolean).join(' · ')}
                        </Box>
                        {copy.uploadMs != null && (
                            <Box component="span" data-testid="server-copy-took" sx={{ color: 'text.primary' }}>
                                {`upload took ${formatDuration(copy.uploadMs)}`}
                            </Box>
                        )}
                        {copy.state === 'uploading' && copy.startedAt && (
                            <Box component="span" sx={{ color: 'text.secondary' }}>
                                {`${formatDuration(Math.max(0, Date.now() - copy.startedAt))} so far`}
                            </Box>
                        )}
                    </Box>
                    <Box sx={{ height: 4, borderRadius: 1, bgcolor: 'action.hover', overflow: 'hidden' }}>
                        <Box sx={{ height: '100%', width: `${copy.percent}%`, bgcolor: COPY_COLOR[copy.state] }} />
                    </Box>
                    <Typography data-testid="server-copy-goes" sx={{ fontFamily: mono, fontSize: '0.6rem', color: 'text.secondary' }}>
                        <Box component="span" sx={{ color: 'text.disabled' }}>stays </Box>
                        {copy.goes}{copy.expiresAt ? ` (by ${dayTime(copy.expiresAt)})` : ''}
                    </Typography>
                </Box>
            ))}
        </Box>
    );
}

ServerCopies.propTypes = { copies: PropTypes.array.isRequired };

export default ServerCopies;
