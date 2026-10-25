import React, { useEffect, useReducer, useRef } from 'react';
import PropTypes from 'prop-types';
import Box from '@mui/material/Box';
import Typography from '@mui/material/Typography';
import IconButton from '@mui/material/IconButton';
import Button from '@mui/material/Button';
import Tooltip from '@mui/material/Tooltip';
import PauseRounded from '@mui/icons-material/PauseRounded';
import PlayArrowRounded from '@mui/icons-material/PlayArrowRounded';
import SkipPreviousRounded from '@mui/icons-material/SkipPreviousRounded';
import SkipNextRounded from '@mui/icons-material/SkipNextRounded';
import FiberManualRecordRounded from '@mui/icons-material/FiberManualRecordRounded';

import { RATES } from './timeline';
import { RX, TX } from './traffic';

// Signalling and everything that is not photo bytes, on the activity strip.
const SIGNAL = '120,160,255';
const BINS = 60;

export function clock(at) {
    const date = new Date(at);
    const pad = (value, length = 2) => String(value).padStart(length, '0');
    return `${pad(date.getHours())}:${pad(date.getMinutes())}:${pad(date.getSeconds())}.${pad(date.getMilliseconds(), 3)}`;
}

/** How far behind the live edge, as -12.3 s or -1:45. */
export function behind(ms) {
    const seconds = Math.max(0, ms) / 1000;
    if (seconds < 60) return `-${seconds.toFixed(1)} s`;
    const whole = Math.round(seconds);
    return `-${Math.floor(whole / 60)}:${String(whole % 60).padStart(2, '0')}`;
}

/**
 * Re-render with the recording, and on a timer while the clock moves on its
 * own: a replay has to reach the live edge even when nothing new arrives.
 */
export function useTimeline(timeline, { idle = 1000 } = {}) {
    const [, bump] = useReducer(value => value + 1, 0);
    useEffect(() => timeline.subscribe(bump), [timeline]);
    const replaying = timeline.replaying;
    // `idle` is how often to redraw while not replaying; 0 waits for news.
    const every = replaying ? 200 : idle;
    useEffect(() => {
        if (!every) return undefined;
        const timer = setInterval(() => {
            if (!timeline.tick()) bump();
        }, every);
        return () => clearInterval(timer);
    }, [timeline, every]);
}

/**
 * The scrubber's background: how much traffic each moment of the recording
 * had, so you can see where to rewind to. Bytes in are green, bytes out
 * amber, signalling blue. What comes after the moment on screen is faint.
 */
function TrafficStrip({ timeline, from, to, at }) {
    const ref = useRef(null);
    useEffect(() => {
        const canvas = ref.current;
        const ctx = canvas?.getContext?.('2d');
        if (!ctx) return;
        const width = canvas.clientWidth || 120;
        const height = canvas.clientHeight || 20;
        const dpr = window.devicePixelRatio || 1;
        canvas.width = width * dpr;
        canvas.height = height * dpr;
        ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
        ctx.clearRect(0, 0, width, height);
        const span = Math.max(1, to - from);
        const bins = Array.from({ length: BINS }, () => ({ rx: 0, tx: 0, other: 0 }));
        timeline.entries.forEach(entry => {
            if (entry.seen === false) return;
            const index = Math.floor((entry.at - from) / span * BINS);
            if (index < 0 || index >= BINS) return;
            const bin = bins[index];
            if (entry.kind === 'rx') bin.rx++;
            else if (entry.kind === 'tx') bin.tx++;
            else bin.other++;
        });
        const peak = Math.max(1, ...bins.map(bin => bin.rx + bin.tx + bin.other));
        const barW = width / BINS;
        const cut = (at - from) / span * width;
        bins.forEach((bin, index) => {
            let y = height;
            const x = index * barW;
            const ahead = x > cut;
            [[bin.other, SIGNAL], [bin.tx, TX], [bin.rx, RX]].forEach(([count, rgb]) => {
                if (!count) return;
                // Even one event should be visible as a tick.
                const h = Math.max(2, count / peak * (height - 2));
                y -= h;
                ctx.fillStyle = `rgba(${rgb},${ahead ? 0.25 : 0.8})`;
                ctx.fillRect(x + 0.5, y, Math.max(1, barW - 1), h);
            });
        });
    });
    return (
        <Box component="canvas" ref={ref} aria-hidden="true" sx={{
            position: 'absolute', inset: 0, width: '100%', height: '100%', pointerEvents: 'none',
            borderRadius: 0.5, bgcolor: 'action.hover',
        }} />
    );
}

TrafficStrip.propTypes = {
    timeline: PropTypes.object.isRequired,
    from: PropTypes.number.isRequired,
    to: PropTypes.number.isRequired,
    at: PropTypes.number.isRequired,
};

const mono = { fontFamily: 'var(--font-mono)' };

/**
 * Live, held or replay. Live follows the room as it happens. Hold stops the
 * map so each label can be read. Play from a held moment replays the room's
 * real traffic at the chosen speed, until it reaches live again. The arrows
 * go one event at a time; the strip rewinds up to two minutes.
 */
export default function Transport({ timeline }) {
    useTimeline(timeline);
    const live = timeline.playing;
    const replaying = timeline.replaying;
    const bounds = timeline.bounds;
    const at = timeline.clock();
    const ahead = timeline.missed();
    const hasEvents = timeline.entries.length > 0;
    const speed = timeline.speed;
    const lag = bounds.to - at;

    const mode = live ? 'live' : replaying ? 'replay' : 'held';
    const toggle = () => {
        if (live || replaying) timeline.pause();
        else timeline.play();
    };
    const toggleLabel = live ? 'Hold the traffic' : replaying ? 'Hold the replay' : 'Play from here';
    const nextSpeed = RATES[(RATES.indexOf(speed) + 1) % RATES.length];
    const scrubbing = useRef(false);

    return (
        <Box
            data-testid="transport"
            data-mode={mode}
            sx={{
                display: 'flex', alignItems: 'center', gap: { xs: 0.25, sm: 0.5 }, px: 0.5, py: 0.25, minWidth: 0,
                flex: { xs: '1 1 100%', sm: '1 1 auto' },
                borderRight: { xs: 0, sm: 1 }, borderBottom: { xs: 1, sm: 0 }, borderColor: 'divider',
            }}
        >
            <Tooltip title={{
                live: 'You see the traffic as it happens.',
                held: 'The map is stopped at this moment.',
                replay: `The room's traffic plays again at ${speed}× speed.`,
            }[mode]}>
                <Box data-testid="transport-mode" sx={{
                    ...mono, display: 'flex', alignItems: 'center', gap: 0.4, flex: 'none',
                    fontSize: '0.6rem', fontWeight: 700, letterSpacing: '0.08em', px: 0.6, py: 0.15, borderRadius: 1,
                    border: 1,
                    borderColor: live ? 'success.main' : 'warning.main',
                    color: live ? 'success.main' : 'warning.main',
                }}>
                    {live && (
                        <FiberManualRecordRounded sx={{
                            fontSize: '0.6rem',
                            animation: 'pgLivePulse 1.6s ease-in-out infinite',
                            '@keyframes pgLivePulse': { '50%': { opacity: 0.25 } },
                            '@media (prefers-reduced-motion: reduce)': { animation: 'none' },
                        }} />
                    )}
                    {live ? 'LIVE' : replaying ? `REPLAY ${speed}×` : 'HELD'}
                </Box>
            </Tooltip>
            <Tooltip title="Previous event (←)">
                <span>
                    <IconButton size="small" onClick={() => timeline.step(-1)} aria-label="Previous event" disabled={!hasEvents}>
                        <SkipPreviousRounded fontSize="small" />
                    </IconButton>
                </span>
            </Tooltip>
            <Tooltip title={`${toggleLabel} (Space)`}>
                <IconButton size="small" onClick={toggle} aria-label={toggleLabel} aria-pressed={!live && !replaying}>
                    {live || replaying ? <PauseRounded fontSize="small" /> : <PlayArrowRounded fontSize="small" />}
                </IconButton>
            </Tooltip>
            <Tooltip title="Next event (→)">
                <span>
                    <IconButton size="small" onClick={() => timeline.step(1)} aria-label="Next event" disabled={live || !hasEvents}>
                        <SkipNextRounded fontSize="small" />
                    </IconButton>
                </span>
            </Tooltip>
            <Tooltip title="Drag to go back in time. The map keeps the last 2 minutes. Each bar is the traffic at that moment.">
                <Box sx={{ position: 'relative', flex: '1 1 90px', minWidth: 40, height: 22 }}>
                    <TrafficStrip timeline={timeline} from={bounds.from} to={bounds.to} at={at} />
                    <Box
                        component="input"
                        type="range"
                        aria-label="Rewind through the room's traffic"
                        aria-valuetext={live ? 'live' : `${clock(at).slice(0, 8)}, ${behind(lag)}`}
                        value={Math.round(at)}
                        min={Math.round(bounds.from)}
                        max={Math.round(bounds.to)}
                        step={10}
                        onPointerDown={() => { scrubbing.current = replaying; }}
                        onChange={event => {
                            const value = Number(event.target.value);
                            // Dragged all the way to the end: that is live.
                            if (value >= bounds.to - 50) timeline.resume();
                            else timeline.seek(value);
                        }}
                        onPointerUp={() => {
                            // A replay carries on from where it was dropped.
                            if (scrubbing.current && !timeline.playing) timeline.play();
                            scrubbing.current = false;
                        }}
                        sx={{
                            position: 'absolute', inset: 0, width: '100%', height: '100%', m: 0,
                            WebkitAppearance: 'none', appearance: 'none', background: 'transparent', cursor: 'pointer',
                            '&::-webkit-slider-runnable-track': { height: '100%', background: 'transparent' },
                            '&::-moz-range-track': { height: '100%', background: 'transparent' },
                            '&::-webkit-slider-thumb': {
                                WebkitAppearance: 'none', width: 3, height: 22, borderRadius: 1,
                                bgcolor: live ? 'success.main' : 'warning.main',
                            },
                            '&::-moz-range-thumb': {
                                width: 3, height: 22, border: 0, borderRadius: 1,
                                bgcolor: live ? 'success.main' : 'warning.main',
                            },
                            '&:focus-visible': { outline: '2px solid', outlineColor: 'primary.main', outlineOffset: 1 },
                        }}
                    />
                </Box>
            </Tooltip>
            <Typography data-testid="transport-time" sx={{
                ...mono, fontSize: '0.6rem', lineHeight: 1.2, color: live ? 'text.disabled' : 'warning.main',
                whiteSpace: 'nowrap', minWidth: '4.6rem', textAlign: 'right',
                // A phone has the moment on the map instead.
                display: { xs: 'none', sm: 'block' },
            }}>
                {live ? clock(at).slice(0, 8) : clock(at)}
                {!live && <Box component="span" sx={{ display: 'block', color: 'text.secondary' }}>{behind(lag)}</Box>}
            </Typography>
            <Tooltip title={`Replay speed. Select for ${nextSpeed}×.`}>
                <Button
                    size="small"
                    onClick={() => timeline.setSpeed(nextSpeed)}
                    aria-label={`Replay speed ${speed}×`}
                    sx={{ ...mono, minWidth: 0, px: 0.5, fontSize: '0.62rem', textTransform: 'none', flex: 'none', color: 'text.secondary' }}
                >
                    {speed}×
                </Button>
            </Tooltip>
            {!live && (
                <Tooltip title={ahead
                    ? `Go to live traffic (L). ${ahead} ${ahead === 1 ? 'event' : 'events'} came after this moment.`
                    : 'Go to live traffic (L).'}>
                    <Button
                        size="small"
                        variant="outlined"
                        color="success"
                        onClick={() => timeline.resume()}
                        data-testid="go-live"
                        startIcon={<FiberManualRecordRounded sx={{ fontSize: '0.7rem !important' }} />}
                        sx={{ ...mono, textTransform: 'none', fontSize: '0.62rem', flex: 'none', py: 0, px: 0.75, minWidth: 0 }}
                    >
                        {ahead ? `Live +${ahead}` : 'Live'}
                    </Button>
                </Tooltip>
            )}
        </Box>
    );
}

Transport.propTypes = { timeline: PropTypes.object.isRequired };
