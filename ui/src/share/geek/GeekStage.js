import React, { useState, useEffect, useRef } from 'react';
import PropTypes from 'prop-types';
import Box from '@mui/material/Box';
import Tabs from '@mui/material/Tabs';
import Tab from '@mui/material/Tab';
import Typography from '@mui/material/Typography';

import TopologyView from '../topology/TopologyView';
import MeView from '../MeView';
import { describeEvent, LOGGED_EVENTS } from './packetLog';

const MAX_LINES = 200;
// Transfer progress fires many times a second; one line per photo per this long.
const SAME_KEY_MS = 1500;

const KIND_COLOR = {
    wire: 'primary.main',
    rx: 'success.main',
    tx: 'info.main',
    peer: 'warning.main',
    link: 'secondary.main',
    photo: 'text.primary',
    ice: 'text.secondary',
    sse: 'text.secondary',
};

function clock(at) {
    const date = new Date(at);
    const pad = (value, length = 2) => String(value).padStart(length, '0');
    return `${pad(date.getHours())}:${pad(date.getMinutes())}:${pad(date.getSeconds())}.${pad(date.getMilliseconds(), 3)}`;
}

/** Collect log lines from the app's events while mounted, newest first. */
function usePacketLog(emitter) {
    const [lines, setLines] = useState([]);
    const lastByKey = useRef(new Map());

    useEffect(() => {
        let id = 0;
        const handlers = LOGGED_EVENTS.map(name => {
            const handler = (...args) => {
                const entry = describeEvent(name, args);
                if (!entry) return;
                const at = Date.now();
                if (entry.key) {
                    if (at - (lastByKey.current.get(entry.key) || 0) < SAME_KEY_MS) return;
                    lastByKey.current.set(entry.key, at);
                }
                id += 1;
                setLines(prev => [{ ...entry, id, at }, ...prev].slice(0, MAX_LINES));
            };
            emitter.on(name, handler);
            return [name, handler];
        });
        return () => handlers.forEach(([name, handler]) => emitter.removeListener(name, handler));
    }, [emitter]);

    return lines;
}

function PacketLog({ lines }) {
    if (!lines.length) {
        return (
            <Typography variant="caption" sx={{ display: 'block', p: 1.5, fontFamily: 'var(--font-mono)', color: 'text.disabled' }}>
                listening… share a photo or invite someone to see traffic
            </Typography>
        );
    }
    return (
        <Box component="ol" role="log" aria-label="Network events" sx={{ m: 0, px: 1.5, py: 1, listStyle: 'none' }}>
            {lines.map(line => (
                <Box component="li" key={line.id} sx={{
                    display: 'grid',
                    gridTemplateColumns: '6.4rem 3rem minmax(0, 1fr)',
                    gap: 1,
                    fontFamily: 'var(--font-mono)',
                    fontSize: '0.68rem',
                    lineHeight: 1.6,
                }}>
                    <Box component="span" sx={{ color: 'text.disabled' }}>{clock(line.at)}</Box>
                    <Box component="span" sx={{ color: KIND_COLOR[line.kind], textTransform: 'uppercase' }}>{line.kind}</Box>
                    <Box component="span" sx={{ color: 'text.secondary', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                        {line.text}
                    </Box>
                </Box>
            ))}
        </Box>
    );
}

/**
 * Geek mode's main stage: the live network graph on top, with what is
 * crossing the wire, and this device's network path, underneath.
 */
function GeekStage({ master, isMobile }) {
    const [tab, setTab] = useState(0);
    const lines = usePacketLog(master.emitter);

    return (
        <Box sx={{
            display: 'flex',
            flexDirection: 'column',
            minWidth: 0,
            flex: isMobile ? 'none' : 1,
            height: isMobile ? '58vh' : 'auto',
            // The graph needs 300px and the log 150px; short phones would overlap the photos.
            minHeight: isMobile ? 450 : 0,
            borderBottom: isMobile ? 1 : 0,
            borderColor: 'divider',
        }}>
            <Box sx={{ flex: 1, minHeight: 0 }}>
                <TopologyView master={master} fillHeight />
            </Box>
            <Box sx={{
                height: isMobile ? 150 : '34%',
                minHeight: isMobile ? 150 : 180,
                display: 'flex',
                flexDirection: 'column',
                borderTop: 1,
                borderColor: 'divider',
                background: 'color-mix(in srgb, var(--paper) 86%, transparent)',
            }}>
                <Tabs
                    value={tab}
                    onChange={(event, value) => setTab(value)}
                    sx={{
                        minHeight: 32,
                        borderBottom: 1,
                        borderColor: 'divider',
                        '& .MuiTab-root': {
                            minHeight: 32,
                            py: 0.5,
                            fontSize: '0.7rem',
                            fontFamily: 'var(--font-mono)',
                            letterSpacing: '0.06em',
                        },
                    }}
                >
                    <Tab label={`Packets${lines.length ? ' · ' + lines.length : ''}`} />
                    <Tab label="This device" />
                </Tabs>
                <Box sx={{ flex: 1, minHeight: 0, overflow: 'auto' }}>
                    {tab === 0 ? <PacketLog lines={lines} /> : <MeView master={master} />}
                </Box>
            </Box>
        </Box>
    );
}

GeekStage.propTypes = {
    master: PropTypes.object.isRequired,
    isMobile: PropTypes.bool,
};

export default GeekStage;
