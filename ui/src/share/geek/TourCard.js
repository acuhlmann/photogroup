import React, { useEffect, useReducer } from 'react';
import PropTypes from 'prop-types';
import Box from '@mui/material/Box';
import Stack from '@mui/material/Stack';
import Typography from '@mui/material/Typography';
import Button from '@mui/material/Button';
import IconButton from '@mui/material/IconButton';
import CloseRounded from '@mui/icons-material/CloseRounded';
import PauseRounded from '@mui/icons-material/PauseRounded';
import PlayArrowRounded from '@mui/icons-material/PlayArrowRounded';
import ArrowBackRounded from '@mui/icons-material/ArrowBackRounded';
import ArrowForwardRounded from '@mui/icons-material/ArrowForwardRounded';
import SlowMotionVideoRounded from '@mui/icons-material/SlowMotionVideoRounded';

import { SPEEDS } from './tourPlayer';
import { explainEntry } from './explain';

const mono = 'var(--font-mono)';
const TONE = { good: 'success.main' };

function useBump(subscribe) {
    const [, bump] = useReducer(value => value + 1, 0);
    useEffect(() => subscribe(bump), [subscribe]);
}

/** Who gets to see what at this step, one line each. */
function Sees({ sees }) {
    if (!sees?.length) return null;
    return (
        <Box component="dl" sx={{ m: 0, mt: 1, display: 'grid', gridTemplateColumns: 'max-content minmax(0, 1fr)', columnGap: 1, rowGap: 0.4 }}>
            {sees.map((item, index) => (
                <React.Fragment key={index}>
                    <Box component="dt" sx={{ fontFamily: mono, fontSize: '0.6rem', letterSpacing: '0.04em', color: TONE[item.tone] || 'secondary.main', textTransform: 'uppercase', pt: '2px' }}>
                        {item.who}
                    </Box>
                    <Box component="dd" sx={{ m: 0, fontSize: '0.74rem', lineHeight: 1.45, color: 'text.secondary' }}>{item.what}</Box>
                </React.Fragment>
            ))}
        </Box>
    );
}

Sees.propTypes = { sees: PropTypes.array };

const card = {
    position: 'absolute', zIndex: 2, p: 1.5, borderRadius: 2, border: 1, borderColor: 'divider',
    bgcolor: 'background.paper', boxShadow: 6,
};

/**
 * The tour's narrator: what this step is about, who sees what, and the
 * controls to walk it at your own pace, let it run, hold it or slow it down.
 */
export function TourCard({ player, onExit, heading = 'HOW A SHARE WORKS' }) {
    useBump(player.subscribe);
    const step = player.step;
    const [, tick] = useReducer(value => value + 1, 0);
    // The step's progress bar moves with the player's own clock.
    useEffect(() => {
        const timer = setInterval(tick, 200);
        return () => clearInterval(timer);
    }, []);
    if (!step) return null;
    const last = player.index === player.count - 1;
    return (
        <Box
            role="region"
            aria-label="How a share works"
            data-testid="tour-card"
            sx={{
                // A panel beside the map (below it on a phone), so the step
                // never hides the boxes it is talking about.
                flex: 'none', p: 1.5, bgcolor: 'background.paper', overflow: 'auto',
                width: { xs: 'auto', sm: 380 }, maxHeight: { xs: '52%', sm: 'none' },
                borderTop: { xs: 1, sm: 0 }, borderRight: { xs: 0, sm: 1 }, borderColor: 'divider',
            }}
        >
            <Stack direction="row" sx={{ alignItems: 'center', mb: 0.5 }}>
                <Typography sx={{ flex: 1, fontFamily: mono, fontSize: '0.62rem', letterSpacing: '0.08em', color: 'primary.main' }}>
                    {`${heading} · ${player.index + 1}/${player.count}`}
                </Typography>
                <IconButton size="small" aria-label="Leave the tour" onClick={onExit}><CloseRounded fontSize="small" /></IconButton>
            </Stack>
            <Typography component="h2" data-testid="tour-title" sx={{ fontSize: '1rem', fontWeight: 700, lineHeight: 1.3, mb: 0.75 }}>
                {step.title}
            </Typography>
            <Typography sx={{ fontSize: '0.8rem', lineHeight: 1.55 }}>{step.body}</Typography>
            <Sees sees={step.sees} />

            <Box aria-hidden="true" sx={{ mt: 1.25, height: 3, borderRadius: 3, bgcolor: 'action.hover', overflow: 'hidden' }}>
                <Box sx={{ height: '100%', width: `${Math.round(player.progress * 100)}%`, bgcolor: 'primary.main' }} />
            </Box>
            <Stack direction="row" spacing={0.5} sx={{ mt: 1, alignItems: 'center', flexWrap: 'wrap', rowGap: 0.5 }}>
                <Button size="small" startIcon={<ArrowBackRounded />} disabled={player.index === 0}
                    onClick={() => player.prev()} sx={{ textTransform: 'none' }}>
                    Back
                </Button>
                <IconButton size="small" onClick={() => player.setHeld(!player.held)}
                    aria-label={player.held ? 'Let the packets move' : 'Hold the packets where they are'} aria-pressed={player.held}>
                    {player.held ? <PlayArrowRounded fontSize="small" /> : <PauseRounded fontSize="small" />}
                </IconButton>
                <Button size="small" variant={player.auto ? 'contained' : 'text'} onClick={() => player.setAuto(!player.auto)}
                    aria-pressed={player.auto} sx={{ textTransform: 'none', fontFamily: mono, fontSize: '0.68rem' }}>
                    {player.auto ? 'Playing all' : 'Play all'}
                </Button>
                <Stack direction="row" sx={{ alignItems: 'center' }} role="group" aria-label="Speed">
                    <SlowMotionVideoRounded sx={{ fontSize: 15, color: 'text.disabled', mr: 0.25 }} />
                    {SPEEDS.map(value => (
                        <Button key={value} size="small" onClick={() => player.setSpeed(value)} aria-pressed={player.speed === value}
                            sx={{ minWidth: 0, px: 0.6, fontFamily: mono, fontSize: '0.64rem', color: player.speed === value ? 'primary.main' : 'text.disabled' }}>
                            {value}×
                        </Button>
                    ))}
                </Stack>
                <Box sx={{ flex: 1 }} />
                <Button size="small" variant="contained" endIcon={last ? null : <ArrowForwardRounded />}
                    onClick={() => (last ? onExit() : player.next())} sx={{ textTransform: 'none' }}>
                    {last ? 'Done' : 'Next'}
                </Button>
            </Stack>
            <Stack direction="row" spacing={0.5} sx={{ mt: 1, justifyContent: 'center' }} role="tablist" aria-label="Steps">
                {Array.from({ length: player.count }, (_, index) => (
                    <Box
                        key={index}
                        component="button"
                        type="button"
                        role="tab"
                        aria-selected={index === player.index}
                        aria-label={`Step ${index + 1}`}
                        onClick={() => player.goto(index)}
                        sx={{
                            all: 'unset', cursor: 'pointer', width: index === player.index ? 16 : 7, height: 7, borderRadius: 7,
                            bgcolor: index === player.index ? 'primary.main' : index < player.index ? 'primary.light' : 'action.disabled',
                            transition: 'width .15s', '&:focus-visible': { outline: '2px solid', outlineColor: 'primary.main' },
                        }}
                    />
                ))}
            </Stack>
        </Box>
    );
}

TourCard.propTypes = {
    player: PropTypes.object.isRequired,
    onExit: PropTypes.func.isRequired,
    heading: PropTypes.string,
};

/**
 * While the real traffic is held on one event, what that event is and who
 * sees it: the recording, explained a step at a time.
 */
export function ExplainCard({ timeline }) {
    useBump(timeline.subscribe);
    const entry = timeline.shown();
    const explained = explainEntry(entry);
    if (!explained) return null;
    return (
        <Box data-testid="explain-card" role="status" sx={{
            ...card, p: 1.25, left: 8, bottom: 34, right: { xs: 8, sm: 'auto' }, width: { sm: 360 },
        }}>
            <Typography sx={{ fontFamily: mono, fontSize: '0.6rem', letterSpacing: '0.08em', color: 'warning.main' }}>
                {`HELD ON · ${entry.kind.toUpperCase()}`}
            </Typography>
            <Typography sx={{ fontSize: '0.88rem', fontWeight: 700, mt: 0.25 }}>{explained.title}</Typography>
            {entry.text && (
                <Typography sx={{ fontFamily: mono, fontSize: '0.64rem', color: 'text.secondary', mt: 0.25, overflowWrap: 'anywhere' }}>{entry.text}</Typography>
            )}
            <Typography sx={{ fontSize: '0.76rem', lineHeight: 1.5, mt: 0.5 }}>{explained.body}</Typography>
            <Typography sx={{ fontSize: '0.72rem', lineHeight: 1.45, mt: 0.5, color: 'text.secondary' }}>
                <Box component="span" sx={{ fontFamily: mono, fontSize: '0.6rem', color: 'secondary.main', mr: 0.5 }}>WHO SEES IT</Box>
                {explained.sees}
            </Typography>
            <Typography sx={{ fontFamily: mono, fontSize: '0.58rem', color: 'text.disabled', mt: 0.75 }}>
                ← → previous / next event · Space plays from here · L goes live
            </Typography>
        </Box>
    );
}

ExplainCard.propTypes = { timeline: PropTypes.object.isRequired };
