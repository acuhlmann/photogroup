import React, { useEffect, useState } from 'react';
import PropTypes from 'prop-types';
import Box from '@mui/material/Box';
import Stack from '@mui/material/Stack';
import Button from '@mui/material/Button';
import ButtonBase from '@mui/material/ButtonBase';
import Collapse from '@mui/material/Collapse';
import Typography from '@mui/material/Typography';
import LinearProgress from '@mui/material/LinearProgress';
import CircularProgress from '@mui/material/CircularProgress';
import CheckCircleRounded from '@mui/icons-material/CheckCircleRounded';
import ErrorOutlineRounded from '@mui/icons-material/ErrorOutlineRounded';
import RadioButtonUncheckedRounded from '@mui/icons-material/RadioButtonUncheckedRounded';
import ExpandMoreRounded from '@mui/icons-material/ExpandMoreRounded';
import { formatMs, SLOW_MS, STEP_LABELS, STEPS } from './loadSteps';

export const SLOW_SERVER_TEXT = 'The server does not answer yet. It can take up to a minute to start.';
export const SLOW_ROOM_TEXT = 'The room takes long to open. Check your connection.';
export const FAILED_ROOM_TEXT = 'Cannot open the room now.';
export const OPEN_TEXT = 'The room is open';

/** What the bar says while a step runs. */
export const STEP_RUNNING = {
    app: 'Loading the app…',
    server: 'Connecting to the server…',
    room: 'Joining the room…',
};

/** How long "The room is open" stays before the bar goes. */
export const DONE_SHOW_MS = 1500;

/** The steps as they are now, and again on each change. */
export function useLoadSteps(master) {
    const read = () => master.loadSteps?.snapshot() || { steps: [], lines: [] };
    const [state, setState] = useState(read);
    useEffect(() => {
        const handle = snapshot => setState(snapshot);
        master.emitter.on('loadSteps', handle);
        setState(read());
        return () => master.emitter.removeListener('loadSteps', handle);
    // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [master]);
    return state;
}

/**
 * Whether the server's photo list of the room is here. The copy that this
 * device kept (`kept`) shows earlier but does not count.
 */
export function useRoomSynced(master) {
    const [synced, setSynced] = useState(() => !!master.roomSynced);
    useEffect(() => {
        const handle = event => {
            if (event?.type === 'all' && Array.isArray(event.item) && !event.kept) setSynced(true);
        };
        master.emitter.on('photos', handle);
        if (master.roomSynced) setSynced(true);
        return () => master.emitter.removeListener('photos', handle);
    }, [master]);
    return synced;
}

/** The time now, again and again while something runs. */
function useNow(active, every = 200) {
    const [now, setNow] = useState(() => performance.now());
    useEffect(() => {
        if (!active) return undefined;
        const id = setInterval(() => setNow(performance.now()), every);
        return () => clearInterval(id);
    }, [active, every]);
    return now;
}

function StepIcon({ state, size }) {
    if (state === 'done') return <CheckCircleRounded sx={{ fontSize: size, color: 'primary.main' }} />;
    if (state === 'fail') return <ErrorOutlineRounded sx={{ fontSize: size, color: 'warning.main' }} />;
    if (state === 'run') {
        return (
            <Box sx={{ width: size, height: size, display: 'grid', placeItems: 'center', flexShrink: 0 }}>
                <CircularProgress size={size - 4} thickness={5} />
            </Box>
        );
    }
    return <RadioButtonUncheckedRounded sx={{ fontSize: size, color: 'text.disabled' }} />;
}

StepIcon.propTypes = { state: PropTypes.string, size: PropTypes.number };

/** How long a step took, or has run so far. */
function stepTime(step, now) {
    if (!step || step.state === 'wait') return '';
    if (step.id === 'app') return formatMs(step.endedAt);
    const end = step.state === 'run' ? now : step.endedAt;
    return formatMs(end - step.startedAt);
}

/**
 * A note when the step that runs is slow, or failed. The server step is
 * slow when the server sleeps: the first request starts it.
 */
export function slowNote(steps, now) {
    const failed = steps.find(step => step.state === 'fail' && step.id === 'room');
    if (failed) return FAILED_ROOM_TEXT;
    const running = steps.find(step => step.state === 'run');
    if (!running || now - running.startedAt < SLOW_MS) return '';
    return running.id === 'server' ? SLOW_SERVER_TEXT : SLOW_ROOM_TEXT;
}

/** The step that the bar talks about: the one that runs, else the next one that waits. */
export function currentStep(steps) {
    return steps.find(step => step.state === 'run') || steps.find(step => step.state === 'wait') || null;
}

function StepList({ steps, now, timed }) {
    return (
        <Stack component="ol" spacing={0.75} sx={{ listStyle: 'none', m: 0, p: 0 }}>
            {steps.map(step => (
                <Stack key={step.id} component="li" direction="row" spacing={1.25} sx={{ alignItems: 'center' }}
                    data-step={step.id} data-state={step.state}>
                    <StepIcon state={step.state} size={18} />
                    <Typography variant="body2" sx={{
                        flex: 1,
                        fontWeight: step.state === 'run' ? 600 : 400,
                        color: step.state === 'wait' ? 'text.secondary' : 'text.primary',
                    }}>
                        {STEP_LABELS[step.id]}
                    </Typography>
                    {timed && (
                        <Typography data-time variant="caption" sx={{ color: 'text.secondary', fontFamily: 'var(--font-mono)', fontVariantNumeric: 'tabular-nums' }}>
                            {[step.detail, stepTime(step, now)].filter(Boolean).join(' · ')}
                        </Typography>
                    )}
                </Stack>
            ))}
        </Stack>
    );
}

StepList.propTypes = {
    steps: PropTypes.array.isRequired,
    now: PropTypes.number,
    timed: PropTypes.bool,
};

/** Geek mode: each real event, timed from the start of the page. */
function EventLines({ lines }) {
    return (
        <Box component="pre" data-testid="load-lines" sx={{
            m: 0, mt: 1.25, p: 1, borderRadius: 1, border: 1, borderColor: 'divider', bgcolor: 'background.default',
            fontFamily: 'var(--font-mono)', fontSize: '0.7rem', lineHeight: 1.6, color: 'text.secondary',
            whiteSpace: 'pre-wrap', wordBreak: 'break-all', maxHeight: '35vh', overflow: 'auto',
        }}>
            {lines.slice(-30).map((line, index) => (
                <div key={index}>
                    <Box component="span" sx={{ color: 'primary.main' }}>{`+${(line.at / 1000).toFixed(2)} s`}</Box>
                    {`  ${line.text}`}
                </div>
            ))}
        </Box>
    );
}

EventLines.propTypes = { lines: PropTypes.array.isRequired };

/**
 * A small bar over the room while it opens: the room shows at once, with
 * what this device kept of it, and the bar says what still happens. A tap
 * shows all steps. Simple mode says the step alone, Photographer mode adds
 * how long it runs, geek mode the last real event (all of them on a tap).
 * When the room is open the bar says so for a moment and goes.
 */
export default function RoomLoading({ master, mode = 'simple', synced = false }) {
    const { steps, lines } = useLoadSteps(master);
    const running = steps.some(step => step.state === 'run');
    const failed = steps.some(step => step.id === 'room' && step.state === 'fail');
    const [open, setOpen] = useState(false);
    const [gone, setGone] = useState(synced && !running);
    const now = useNow(running || !synced);
    const done = synced && !running && !failed;

    useEffect(() => {
        if (!done) { setGone(false); return undefined; }
        const id = setTimeout(() => setGone(true), DONE_SHOW_MS);
        return () => clearTimeout(id);
    }, [done]);

    const geek = mode === 'geek';
    const timed = mode !== 'simple';
    const step = currentStep(steps);
    const note = slowNote(steps, now);
    const finished = steps.filter(item => item.state === 'done').length;
    const progress = Math.round(((finished + (running ? 0.5 : 0)) / STEPS.length) * 100);
    const text = failed ? FAILED_ROOM_TEXT
        : done || !step ? OPEN_TEXT
        : STEP_RUNNING[step.id];
    const last = lines[lines.length - 1];
    const side = failed ? '' : done ? '' : timed ? stepTime(step, now) : `${Math.min(finished + 1, STEPS.length)} of ${STEPS.length}`;

    return (
        <Collapse in={!gone} unmountOnExit sx={geek ? {
            position: 'absolute', top: 12, left: '50%', transform: 'translateX(-50%)', zIndex: 5,
            width: 'min(520px, calc(100% - 24px))',
        } : { position: 'sticky', top: 0, zIndex: 3, mb: 1.5 }}>
            <Box role="status" aria-live="polite" data-testid="room-loading" data-mode={mode} data-done={done ? 'yes' : 'no'}
                sx={{
                    borderRadius: 2, border: 1, borderColor: 'divider', bgcolor: 'background.paper', overflow: 'hidden',
                    boxShadow: geek ? 8 : 1, maxWidth: geek ? 'none' : 560, mx: 'auto',
                }}>
                <ButtonBase onClick={() => setOpen(value => !value)} aria-expanded={open}
                    aria-label={open ? 'Hide the steps' : 'Show the steps'}
                    sx={{ width: '100%', display: 'flex', alignItems: 'center', gap: 1.25, px: 1.5, py: 1, textAlign: 'left' }}>
                    <StepIcon state={failed ? 'fail' : done ? 'done' : 'run'} size={20} />
                    <Box sx={{ flex: 1, minWidth: 0 }}>
                        <Typography variant="body2" sx={{ fontWeight: 600 }} noWrap>{text}</Typography>
                        {geek && last && !done && (
                            <Typography variant="caption" noWrap component="div"
                                sx={{ fontFamily: 'var(--font-mono)', color: 'text.secondary' }}>
                                {last.text}
                            </Typography>
                        )}
                    </Box>
                    {side && (
                        <Typography data-side variant="caption" sx={{ color: 'text.secondary', fontFamily: timed ? 'var(--font-mono)' : undefined, flexShrink: 0 }}>
                            {side}
                        </Typography>
                    )}
                    <ExpandMoreRounded fontSize="small" sx={{
                        color: 'text.secondary', transition: 'transform 140ms', transform: open ? 'rotate(180deg)' : 'none',
                    }} />
                </ButtonBase>
                {note && !failed && (
                    <Typography variant="caption" component="p" sx={{ color: 'text.secondary', px: 1.5, pb: 1, mt: -0.5, m: 0 }}>
                        {note}
                    </Typography>
                )}
                {failed && (
                    <Box sx={{ px: 1.5, pb: 1 }}>
                        <Button size="small" variant="outlined" onClick={() => window.location.reload()} sx={{ textTransform: 'none' }}>
                            Try again
                        </Button>
                    </Box>
                )}
                <Collapse in={open}>
                    <Box sx={{ px: 1.5, pb: 1.25 }}>
                        <StepList steps={steps} now={now} timed={timed} />
                        {geek && <EventLines lines={lines} />}
                    </Box>
                </Collapse>
                {!done && !failed && (
                    <LinearProgress variant="determinate" value={progress} sx={{ height: 2 }} aria-hidden="true" />
                )}
            </Box>
        </Collapse>
    );
}

RoomLoading.propTypes = {
    master: PropTypes.object.isRequired,
    mode: PropTypes.oneOf(['simple', 'default', 'geek']),
    synced: PropTypes.bool,
};
