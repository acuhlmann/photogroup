import React, { useState, useEffect, useMemo, useReducer, useCallback, useRef } from 'react';
import PropTypes from 'prop-types';
import Box from '@mui/material/Box';
import Tabs from '@mui/material/Tabs';
import Tab from '@mui/material/Tab';
import Typography from '@mui/material/Typography';
import IconButton from '@mui/material/IconButton';
import Button from '@mui/material/Button';
import ExpandMoreRounded from '@mui/icons-material/ExpandMoreRounded';
import ExpandLessRounded from '@mui/icons-material/ExpandLessRounded';
import PauseRounded from '@mui/icons-material/PauseRounded';
import PlayArrowRounded from '@mui/icons-material/PlayArrowRounded';
import SkipPreviousRounded from '@mui/icons-material/SkipPreviousRounded';
import SkipNextRounded from '@mui/icons-material/SkipNextRounded';
import RadioRounded from '@mui/icons-material/RadioRounded';

import NetworkStage from './NetworkStage';
import MeView from '../MeView';
import { createTimeline } from './timeline';

const HEIGHT_KEY = 'photogroup.geekDrawerHeight';
const COLLAPSED = 33;

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

/** Re-render with the recording: every packet and every playhead move. */
function useTimeline(timeline) {
    const [, bump] = useReducer(value => value + 1, 0);
    useEffect(() => timeline.subscribe(bump), [timeline]);
}

/**
 * Hold the traffic and walk through it. Pause keeps every label on screen to
 * be read; the arrows step one event at a time; the bar scrubs the last two
 * minutes of what the room actually did.
 */
function Transport({ timeline }) {
    useTimeline(timeline);
    const playing = timeline.playing;
    const bounds = timeline.bounds;
    const at = timeline.clock();
    const missed = timeline.missed();
    const shown = timeline.shown();
    const span = Math.max(1, bounds.to - bounds.from);

    return (
        <Box
            data-testid="transport"
            sx={{
                display: 'flex', alignItems: 'center', gap: 0.5, px: 0.5, flex: 'none',
                borderRight: 1, borderColor: 'divider',
            }}
        >
            <IconButton
                size="small"
                onClick={() => (playing ? timeline.pause() : timeline.resume())}
                aria-label={playing ? 'Hold the traffic' : 'Let the traffic run'}
                aria-pressed={!playing}
            >
                {playing ? <PauseRounded fontSize="small" /> : <PlayArrowRounded fontSize="small" />}
            </IconButton>
            <IconButton size="small" onClick={() => timeline.step(-1)} aria-label="Previous event"
                sx={{ visibility: timeline.entries.length ? 'visible' : 'hidden' }}>
                <SkipPreviousRounded fontSize="small" />
            </IconButton>
            <IconButton size="small" onClick={() => timeline.step(1)} aria-label="Next event"
                sx={{ visibility: timeline.entries.length ? 'visible' : 'hidden' }}>
                <SkipNextRounded fontSize="small" />
            </IconButton>
            <Box
                component="input"
                type="range"
                aria-label="Rewind through the room's traffic"
                value={Math.round(at)}
                min={Math.round(bounds.from)}
                max={Math.round(bounds.to)}
                step={10}
                onChange={event => timeline.seek(Number(event.target.value))}
                onMouseUp={() => { if (playing) timeline.resume(); }}
                onTouchEnd={() => { if (playing) timeline.resume(); }}
                sx={{
                    width: { xs: 90, sm: 180 }, height: 20, flex: '1 1 90px', minWidth: 70,
                    accentColor: 'var(--accent)', cursor: 'pointer',
                }}
            />
            <Typography sx={{
                fontFamily: 'var(--font-mono)', fontSize: '0.62rem', color: playing ? 'text.disabled' : 'warning.main',
                whiteSpace: 'nowrap', minWidth: '6.2rem',
            }}>
                {playing ? `${Math.round(span / 1000)}s held live` : `held ${clock(at).slice(0, 8)}`}
            </Typography>
            {!playing && missed > 0 && (
                <Button
                    size="small"
                    variant={shown ? 'text' : 'text'}
                    startIcon={<RadioRounded />}
                    onClick={() => timeline.resume()}
                    sx={{ textTransform: 'none', fontFamily: 'var(--font-mono)', fontSize: '0.65rem', flex: 'none' }}
                >
                    {missed} new
                </Button>
            )}
        </Box>
    );
}

/**
 * The recording as a list. Each line is the same event the map is drawing, so
 * tapping one holds the map on that crossing and lights the route it took.
 */
function PacketLog({ timeline }) {
    useTimeline(timeline);
    const lines = timeline.recent();
    const shown = timeline.shown();

    if (!lines.length) {
        return (
            <Typography variant="caption" sx={{ display: 'block', p: 1.5, fontFamily: 'var(--font-mono)', color: 'text.disabled' }}>
                listening… share a photo or invite someone to see traffic
            </Typography>
        );
    }
    return (
        <Box component="ol" role="log" aria-label="Network events" sx={{ m: 0, px: 0.5, py: 0.5, listStyle: 'none' }}>
            {lines.map(line => {
                const active = shown?.id === line.id;
                return (
                    <Box
                        key={line.id}
                        component="li"
                        data-parked={active ? 'true' : undefined}
                        onClick={() => (active && timeline.playing === false ? timeline.resume() : timeline.focus(line.id))}
                        title={line.flights.length ? 'Hold the map on this crossing' : undefined}
                        sx={{
                            display: 'grid',
                            gridTemplateColumns: '6.4rem 3rem minmax(0, 1fr)',
                            gap: 1,
                            px: 1,
                            py: 0.25,
                            borderRadius: 1,
                            cursor: 'pointer',
                            fontFamily: 'var(--font-mono)',
                            fontSize: '0.68rem',
                            lineHeight: 1.6,
                            bgcolor: active ? 'action.selected' : 'transparent',
                            borderLeft: '2px solid',
                            borderLeftColor: active ? 'warning.main' : 'transparent',
                            '&:hover': { bgcolor: 'action.hover' },
                        }}
                    >
                        <Box component="span" sx={{ color: 'text.disabled' }}>{clock(line.at)}</Box>
                        <Box component="span" sx={{ color: KIND_COLOR[line.kind], textTransform: 'uppercase' }}>{line.kind}</Box>
                        <Box component="span" sx={{ color: 'text.secondary', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                            {line.text}
                        </Box>
                    </Box>
                );
            })}
        </Box>
    );
}

/**
 * Geek mode's whole room: the network map fills the screen, with photos as
 * thumbnails on the devices that hold them, and a drawer along the bottom
 * logs what is crossing the wire and shows this device's network path. The
 * drawer's log and the map read one recording, and the transport above it
 * holds that recording still to be studied.
 */
function GeekStage({ master, tiles, isMobile }) {
    const timeline = useMemo(() => createTimeline(), []);
    const [tab, setTab] = useState(0);
    const [open, setOpen] = useState(!isMobile);
    const [height, setHeight] = useState(() => {
        const saved = Number(localStorage.getItem(HEIGHT_KEY));
        return saved >= 140 && saved <= 600 ? saved : (isMobile ? 260 : 220);
    });
    const drag = useRef(null);
    const openPhoto = useCallback(key => master.emitter.emit('openPhoto', key), [master.emitter]);

    // Space holds and releases the traffic; the arrows walk through it.
    useEffect(() => {
        const onKey = event => {
            const field = event.target;
            if (field && (field.tagName === 'INPUT' || field.tagName === 'TEXTAREA' || field.isContentEditable)) return;
            if (event.key === ' ' || event.key === 'k') {
                event.preventDefault();
                timeline.playing ? timeline.pause() : timeline.resume();
            } else if (event.key === 'ArrowLeft') {
                event.preventDefault();
                timeline.step(-1);
            } else if (event.key === 'ArrowRight') {
                event.preventDefault();
                timeline.step(1);
            } else if (event.key === 'l') {
                timeline.resume();
            }
        };
        window.addEventListener('keydown', onKey);
        return () => window.removeEventListener('keydown', onKey);
    }, [timeline]);

    // A taller log is the point when studying: drag the drawer's top edge.
    useEffect(() => {
        const move = event => {
            if (drag.current === null) return;
            const at = event.touches ? event.touches[0].clientY : event.clientY;
            const next = window.innerHeight - at;
            const clamped = Math.max(COLLAPSED + 107, Math.min(Math.round(window.innerHeight * 0.8), next));
            setHeight(clamped);
        };
        const stop = () => {
            if (drag.current === null) return;
            drag.current = null;
            localStorage.setItem(HEIGHT_KEY, String(height));
        };
        window.addEventListener('pointermove', move);
        window.addEventListener('pointerup', stop);
        return () => {
            window.removeEventListener('pointermove', move);
            window.removeEventListener('pointerup', stop);
        };
    }, [height]);

    const count = timeline.entries.length;
    return (
        <Box sx={{ position: 'relative', flex: 1, minWidth: 0, minHeight: 0, display: 'flex', flexDirection: 'column' }}>
            <Box sx={{ flex: 1, minHeight: 0 }}>
                <NetworkStage master={master} tiles={tiles} onOpenPhoto={openPhoto} timeline={timeline} />
            </Box>
            <Box sx={{
                height: open ? height : COLLAPSED,
                flex: 'none',
                display: 'flex',
                flexDirection: 'column',
                borderTop: 1,
                borderColor: 'divider',
                background: 'color-mix(in srgb, var(--paper) 92%, transparent)',
                '@media (prefers-reduced-motion: reduce)': { transition: 'none' },
            }}>
                {/* Drag this edge to give the log more room. */}
                <Box
                    role="separator"
                    aria-orientation="horizontal"
                    aria-label="Resize the event log"
                    aria-valuenow={open ? height : COLLAPSED}
                    aria-valuemin={COLLAPSED + 107}
                    aria-valuemax={Math.round(window.innerHeight * 0.8)}
                    onPointerDown={() => { drag.current = height; setOpen(true); }}
                    onDoubleClick={() => setOpen(value => !value)}
                    sx={{
                        height: 7, mt: -1, cursor: 'ns-resize', flex: 'none', touchAction: 'none',
                        '&:hover, &:active': { bgcolor: 'action.hover' },
                    }}
                />
                <Box sx={{ display: 'flex', alignItems: 'center', borderBottom: open ? 1 : 0, borderColor: 'divider' }}>
                    <Transport timeline={timeline} />
                    <Tabs
                        value={tab}
                        onChange={(event, value) => { setTab(value); setOpen(true); }}
                        sx={{
                            flex: 1,
                            minHeight: 32,
                            '& .MuiTab-root': {
                                minHeight: 32,
                                py: 0.5,
                                fontSize: '0.7rem',
                                fontFamily: 'var(--font-mono)',
                                letterSpacing: '0.06em',
                            },
                        }}
                    >
                        <Tab label={`Packets${count ? ' · ' + count : ''}`} onClick={() => setOpen(true)} />
                        <Tab label="This device" onClick={() => setOpen(true)} />
                    </Tabs>
                    <IconButton size="small" onClick={() => setOpen(value => !value)}
                        aria-label={open ? 'Hide the log' : 'Show the log'} aria-expanded={open} sx={{ mr: 0.5 }}>
                        {open ? <ExpandMoreRounded fontSize="small" /> : <ExpandLessRounded fontSize="small" />}
                    </IconButton>
                </Box>
                {open && (
                    <Box sx={{ flex: 1, minHeight: 0, overflow: 'auto' }}>
                        {tab === 0 ? <PacketLog timeline={timeline} /> : <MeView master={master} />}
                    </Box>
                )}
            </Box>
        </Box>
    );
}

GeekStage.propTypes = {
    master: PropTypes.object.isRequired,
    tiles: PropTypes.array,
    isMobile: PropTypes.bool,
};

export default GeekStage;
