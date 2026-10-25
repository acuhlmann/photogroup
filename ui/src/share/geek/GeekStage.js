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
import OpenInFullRounded from '@mui/icons-material/OpenInFullRounded';
import CloseFullscreenRounded from '@mui/icons-material/CloseFullscreenRounded';
import SchoolRounded from '@mui/icons-material/SchoolRounded';

import NetworkStage from './NetworkStage';
import TransfersView from './TransfersView';
import Transport, { clock, useTimeline } from './Transport';
import { createTimeline } from './timeline';
import { tourSteps } from './tour';
import { replaySteps } from './replay';
import { createTourPlayer } from './tourPlayer';
import { TourCard, ExplainCard } from './TourCard';

const HEIGHT_KEY = 'photogroup.geekDrawerHeight';
const COLLAPSED = 33;
// Transport bar + tabs + a couple of log lines is the least worth showing.
const MIN_OPEN = 150;
// The map still has to be readable above the drawer.
const SHARE = 0.82;
const DEFAULT_HEIGHT = { desktop: 220, mobile: 260 };

const KIND_COLOR = {
    wire: 'primary.main',
    rx: 'success.main',
    tx: 'info.main',
    peer: 'warning.main',
    link: 'secondary.main',
    photo: 'text.primary',
    ice: 'text.secondary',
    sse: 'text.secondary',
    copy: 'secondary.main',
};

/**
 * The recording as a list. Each line is the same event the map is drawing, so
 * tapping one holds the map on that crossing and lights the route it took.
 */
function PacketLog({ timeline }) {
    useTimeline(timeline, { idle: 0 });
    const lines = timeline.recent();
    const shown = timeline.shown();
    // Held or replayed: what the room did after that moment is not on the map yet.
    const at = timeline.playing ? Infinity : timeline.clock();

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
                const later = line.at > at;
                return (
                    <Box
                        key={line.id}
                        component="li"
                        data-parked={active ? 'true' : undefined}
                        data-later={later ? 'true' : undefined}
                        onClick={() => (active && !timeline.playing ? timeline.resume() : timeline.focus(line.id))}
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
                            opacity: later ? 0.4 : 1,
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
 * logs what is crossing the wire and walks each photo's transfer through its
 * stages, peers and server copy. This device's own network path is on its
 * node on the map. The
 * drawer's log and the map read one recording, and the transport above it
 * holds that recording still to be studied.
 */
function GeekStage({ master, tiles, isMobile }) {
    const timeline = useMemo(() => createTimeline(), []);
    const [tab, setTab] = useState(0);
    const [open, setOpen] = useState(!isMobile);
    const [height, setHeight] = useState(() => {
        const saved = Number(localStorage.getItem(HEIGHT_KEY));
        return Number.isFinite(saved) && saved >= MIN_OPEN
            ? saved
            : (isMobile ? DEFAULT_HEIGHT.mobile : DEFAULT_HEIGHT.desktop);
    });
    const stage = useRef(null);
    const drag = useRef(null);
    const heightRef = useRef(height);
    const [room, setRoom] = useState(0);
    const openPhoto = useCallback(key => master.emitter.emit('openPhoto', key), [master.emitter]);

    // The tour plays into its own recording, so the room's real traffic keeps
    // being logged underneath and is still there when you leave it.
    const tourTimeline = useMemo(() => createTimeline(), []);
    const player = useMemo(() => createTourPlayer({ timeline: tourTimeline }), [tourTimeline]);
    const [touring, setTouring] = useState(false);
    // A real share to replay instead of the example tour: { infoHash, name }.
    const [replay, setReplay] = useState(null);
    const [scene, setScene] = useState(null);
    const [, bumpTour] = useReducer(value => value + 1, 0);
    useEffect(() => player.subscribe(bumpTour), [player]);
    useEffect(() => {
        if (!touring || !scene) return;
        const myPeerId = master.client?.peerId;
        player.load(replay
            ? replaySteps(scene, master.ledger?.get?.(replay.infoHash), { myPeerId, peers: master.peers?.items || [] })
            : tourSteps(scene, { myPeerId, rtcConfig: master.creator?.iceServers }));
    }, [touring, replay, scene, player, master]);
    useEffect(() => {
        if (!touring) return undefined;
        const timer = setInterval(() => player.tick(), 50);
        return () => clearInterval(timer);
    }, [touring, player]);
    const startTour = () => {
        setReplay(null);
        setTouring(true);
        player.start(0);
    };
    /** Play one photo's real transfer back on the map, from its first stage. */
    const startReplay = useCallback(row => {
        setReplay({ infoHash: row.infoHash, name: row.name });
        setTouring(true);
        player.start(0);
        player.setAuto(true);
    }, [player]);
    const exitTour = useCallback(() => {
        player.setAuto(false);
        setTouring(false);
        setReplay(null);
        tourTimeline.clear();
    }, [player, tourTimeline]);

    // Space holds the traffic and plays it on from there; the arrows walk
    // through it one event at a time; L goes back to live. In the tour they
    // walk its steps instead.
    useEffect(() => {
        const onKey = event => {
            const field = event.target;
            if (field && (field.tagName === 'INPUT' || field.tagName === 'TEXTAREA' || field.isContentEditable)) return;
            if (touring) {
                const keys = {
                    ArrowRight: () => player.next(), ArrowLeft: () => player.prev(),
                    ' ': () => player.setHeld(!player.held), Escape: exitTour,
                };
                if (keys[event.key]) {
                    event.preventDefault();
                    keys[event.key]();
                }
                return;
            }
            if (event.key === ' ' || event.key === 'k') {
                event.preventDefault();
                // Live or replaying: hold. Held: play on from there.
                if (timeline.playing || timeline.replaying) timeline.pause();
                else timeline.play();
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
    }, [timeline, touring, player, exitTour]);

    // How much of the stage the log may take. Measured off the stage itself,
    // not the viewport: a phone's browser bar can leave the drawer's bottom
    // below the screen, so `100vh` is not the room that is really there.
    const limit = useCallback(() => {
        const box = room || window.innerHeight;
        return Math.max(MIN_OPEN, Math.round(box * SHARE));
    }, [room]);

    const apply = useCallback((next, persist = true) => {
        const clamped = Math.round(Math.min(limit(), Math.max(MIN_OPEN, next)));
        heightRef.current = clamped;
        setHeight(clamped);
        if (persist) localStorage.setItem(HEIGHT_KEY, String(clamped));
        return clamped;
    }, [limit]);

    useEffect(() => {
        const read = () => {
            const px = Math.round(stage.current?.getBoundingClientRect().height || window.innerHeight);
            setRoom(px);
            // A height saved on a bigger screen has to fit this one.
            apply(heightRef.current, false);
        };
        read();
        if (typeof ResizeObserver === 'function' && stage.current) {
            const observer = new ResizeObserver(read);
            observer.observe(stage.current);
            return () => observer.disconnect();
        }
        window.addEventListener('resize', read);
        return () => window.removeEventListener('resize', read);
    }, [apply]);

    // A taller log is the point when studying: drag the grip and the log
    // follows the finger from wherever it was, up for more lines, down for
    // the map. What you settle on is kept for the next time.
    useEffect(() => {
        const move = event => {
            const started = drag.current;
            if (!started || (event.pointerId !== undefined && event.pointerId !== started.id)) return;
            event.preventDefault();
            apply(started.height + started.at - event.clientY, false);
        };
        const release = event => {
            if (!drag.current || (event.pointerId !== undefined && event.pointerId !== drag.current.id)) return;
            drag.current = null;
            localStorage.setItem(HEIGHT_KEY, String(heightRef.current));
        };
        window.addEventListener('pointermove', move);
        window.addEventListener('pointerup', release);
        window.addEventListener('pointercancel', release);
        return () => {
            window.removeEventListener('pointermove', move);
            window.removeEventListener('pointerup', release);
            window.removeEventListener('pointercancel', release);
        };
    }, [apply]);

    // So the log can be grown without hitting a six-pixel strip: the grip
    // takes focus and resizes on the keys. Space stays the transport's.
    const gripKey = event => {
        const steps = { ArrowUp: 1, PageUp: 3, ArrowDown: -1, PageDown: -3 };
        if (event.key in steps) {
            event.preventDefault();
            event.stopPropagation();
            setOpen(true);
            apply(height + steps[event.key] * 40);
        } else if (event.key === 'Home' || event.key === 'End') {
            event.preventDefault();
            event.stopPropagation();
            setOpen(true);
            apply(event.key === 'End' ? limit() : (isMobile ? DEFAULT_HEIGHT.mobile : DEFAULT_HEIGHT.desktop));
        } else if (event.key === 'Enter') {
            event.preventDefault();
            event.stopPropagation();
            setOpen(value => !value);
        }
    };

    const tallest = limit();
    const full = open && height >= tallest - 1;
    const beforeFull = useRef(0);

    const toggleFull = () => {
        if (full) {
            apply(beforeFull.current || (isMobile ? DEFAULT_HEIGHT.mobile : DEFAULT_HEIGHT.desktop));
        } else {
            beforeFull.current = height;
            setOpen(true);
            apply(tallest);
        }
    };

    const count = timeline.entries.length;
    return (
        <Box ref={stage} sx={{ position: 'relative', flex: 1, minWidth: 0, minHeight: 0, display: 'flex', flexDirection: 'column' }}>
            <Box sx={{ flex: 1, minHeight: 0, position: 'relative', display: 'flex', flexDirection: { xs: 'column-reverse', sm: 'row' } }}>
                {touring && <TourCard player={player} onExit={exitTour} heading={replay ? `REPLAY · ${replay.name}` : undefined} />}
                <Box sx={{ flex: 1, minWidth: 0, minHeight: 0 }}>
                    <NetworkStage master={master} tiles={tiles} onOpenPhoto={openPhoto} timeline={timeline}
                        playback={touring ? tourTimeline : undefined} tour={touring ? { step: player.step, demo: !replay } : null} onScene={setScene} />
                </Box>
                {!touring && (
                    <>
                        <ExplainCard timeline={timeline} />
                        <Button
                            size="small"
                            variant="outlined"
                            startIcon={<SchoolRounded />}
                            onClick={startTour}
                            data-testid="start-tour"
                            sx={{
                                position: 'absolute', zIndex: 1, left: '50%', transform: 'translateX(-50%)', bottom: 8,
                                textTransform: 'none', fontFamily: 'var(--font-mono)', fontSize: '0.7rem',
                                bgcolor: 'background.paper', '&:hover': { bgcolor: 'background.paper' },
                            }}
                        >
                            How a share works
                        </Button>
                    </>
                )}
            </Box>
            <Box sx={{
                // The tour tells its own story; the live log waits underneath.
                display: touring ? 'none' : 'flex',
                position: 'relative',
                height: open ? height : 'auto',
                flex: 'none',
                flexDirection: 'column',
                borderTop: 1,
                borderColor: 'divider',
                background: 'color-mix(in srgb, var(--paper) 92%, transparent)',
                '@media (prefers-reduced-motion: reduce)': { transition: 'none' },
            }}>
                {/* The grip: drag it for a taller log, or focus it and press the
                    arrows. It straddles the edge, so it is reachable without
                    taking room from the transport bar above the log. */}
                <Box
                    role="separator"
                    aria-orientation="horizontal"
                    aria-label="Event log height"
                    aria-valuenow={open ? height : COLLAPSED}
                    aria-valuemin={MIN_OPEN}
                    aria-valuemax={tallest}
                    aria-valuetext={open ? `${height} pixels tall` : 'collapsed'}
                    title="Drag up for a taller log"
                    tabIndex={0}
                    onPointerDown={event => {
                        if (event.button) return;
                        event.currentTarget.setPointerCapture?.(event.pointerId);
                        drag.current = { id: event.pointerId, at: event.clientY, height };
                        setOpen(true);
                    }}
                    onPointerMove={event => {
                        // Where pointer capture is missing, keep the grip's own
                        // moves alive; the window listener covers the rest.
                        if (drag.current) event.preventDefault();
                    }}
                    onKeyDown={gripKey}
                    onDoubleClick={() => setOpen(value => !value)}
                    sx={{
                        position: 'absolute', top: -8, left: 0, right: 0, height: 16,
                        cursor: 'ns-resize', touchAction: 'none', outline: 'none',
                        display: 'flex', alignItems: 'center', justifyContent: 'center',
                        zIndex: 1,
                        '&:hover > span, &:focus-visible > span': { width: 72, bgcolor: 'text.secondary' },
                    }}
                >
                    <Box component="span" sx={{
                        width: 44, height: 5, flex: 'none', borderRadius: 5,
                        bgcolor: 'action.disabled', transition: 'width .12s ease-out',
                        '@media (prefers-reduced-motion: reduce)': { transition: 'none' },
                    }} />
                </Box>
                <Box sx={{ display: 'flex', flexWrap: 'wrap', alignItems: 'center', borderBottom: open ? 1 : 0, borderColor: 'divider' }}>
                    <Transport timeline={timeline} />
                    <Tabs
                        value={tab}
                        onChange={(event, value) => { setTab(value); setOpen(true); }}
                        sx={{
                            flex: '1 0 auto',
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
                        <Tab label="Transfers" onClick={() => setOpen(true)} />
                    </Tabs>
                    <IconButton size="small" onClick={toggleFull}
                        aria-label={full ? 'Give the map its room back' : 'Give the log the whole screen'}
                        aria-pressed={full} sx={{ mr: 0.25 }}>
                        {full ? <CloseFullscreenRounded fontSize="small" /> : <OpenInFullRounded fontSize="small" />}
                    </IconButton>
                    <IconButton size="small" onClick={() => setOpen(value => !value)}
                        aria-label={open ? 'Hide the log' : 'Show the log'} aria-expanded={open} sx={{ mr: 0.5 }}>
                        {open ? <ExpandMoreRounded fontSize="small" /> : <ExpandLessRounded fontSize="small" />}
                    </IconButton>
                </Box>
                {open && (
                    <Box sx={{ flex: 1, minHeight: 0, overflow: 'auto' }}>
                        {tab === 0 ? <PacketLog timeline={timeline} /> : <TransfersView master={master} onReplay={startReplay} />}
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
