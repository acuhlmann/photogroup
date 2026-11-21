import React, { useEffect, useState } from 'react';
import PropTypes from 'prop-types';
import Box from '@mui/material/Box';
import Stack from '@mui/material/Stack';
import Button from '@mui/material/Button';
import Typography from '@mui/material/Typography';
import Skeleton from '@mui/material/Skeleton';
import CircularProgress from '@mui/material/CircularProgress';
import CheckCircleRounded from '@mui/icons-material/CheckCircleRounded';
import ErrorOutlineRounded from '@mui/icons-material/ErrorOutlineRounded';
import RadioButtonUncheckedRounded from '@mui/icons-material/RadioButtonUncheckedRounded';
import { formatMs, SLOW_MS, STEP_LABELS } from './loadSteps';

/** Until the room's photo list is here, then at most this long before the room shows anyway. */
export const GIVE_UP_MS = 20000;

export const SLOW_SERVER_TEXT = 'The server does not answer yet. It can take up to a minute to start.';
export const SLOW_ROOM_TEXT = 'The room takes long to open. Check your connection.';
export const FAILED_ROOM_TEXT = 'Cannot open the room now.';

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

/** Whether the room's photo list is here, so the room can show. */
export function useRoomSynced(master) {
    const [synced, setSynced] = useState(() => !!master.roomSynced);
    useEffect(() => {
        const handle = event => {
            if (event?.type === 'all' && Array.isArray(event.item)) setSynced(true);
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
            <Box sx={{ width: size, height: size, display: 'grid', placeItems: 'center' }}>
                <CircularProgress size={size - 4} thickness={5} />
            </Box>
        );
    }
    return <RadioButtonUncheckedRounded sx={{ fontSize: size, color: 'text.disabled' }} />;
}

StepIcon.propTypes = { state: PropTypes.string, size: PropTypes.number };

/** How long a step took, or has run so far. */
function stepTime(step, now) {
    if (step.state === 'wait') return '';
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

function StepList({ steps, now, timed, dense }) {
    const size = dense ? 18 : 24;
    return (
        <Stack component="ol" spacing={dense ? 0.75 : 1.5} sx={{ listStyle: 'none', m: 0, p: 0 }}>
            {steps.map(step => (
                <Stack key={step.id} component="li" direction="row" spacing={1.5} sx={{ alignItems: 'center' }}
                    data-step={step.id} data-state={step.state}>
                    <StepIcon state={step.state} size={size} />
                    <Typography variant={dense ? 'body2' : 'body1'} sx={{
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
    dense: PropTypes.bool,
};

/** Geek mode: each real event, timed from the start of the page. */
function EventLines({ lines }) {
    const shown = lines.slice(-14);
    return (
        <Box component="pre" data-testid="load-lines" sx={{
            m: 0, mt: 1.5, p: 1.25, borderRadius: 1, border: 1, borderColor: 'divider', bgcolor: 'background.default',
            fontFamily: 'var(--font-mono)', fontSize: '0.72rem', lineHeight: 1.6, color: 'text.secondary',
            whiteSpace: 'pre-wrap', wordBreak: 'break-all', maxHeight: '40vh', overflow: 'auto',
        }}>
            {shown.map((line, index) => (
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
 * What a room page shows until its photo list is here: the steps of
 * opening it, as index.html showed them before the app ran. Simple mode
 * shows the steps alone. Photographer mode adds how long each one took and
 * the outline of the list that comes. Geek mode adds each real event.
 */
export default function RoomLoading({ master, mode = 'simple', roomName = '', onGiveUp }) {
    const { steps, lines } = useLoadSteps(master);
    const running = steps.some(step => step.state === 'run');
    const now = useNow(running || mode !== 'simple');
    const note = slowNote(steps, now);
    const failed = steps.some(step => step.id === 'room' && step.state === 'fail');
    const [late, setLate] = useState(false);

    useEffect(() => {
        const id = setTimeout(() => setLate(true), GIVE_UP_MS);
        return () => clearTimeout(id);
    }, []);

    const title = roomName ? `Opening “${roomName}”` : 'Opening the room';
    const geek = mode === 'geek';
    const timed = mode !== 'simple';

    const actions = (failed || late) && (
        <Stack direction="row" spacing={1} sx={{ mt: 2, flexWrap: 'wrap', gap: 1 }}>
            <Button variant="contained" onClick={() => window.location.reload()} sx={{ textTransform: 'none' }}>
                Try again
            </Button>
            {onGiveUp && (
                <Button variant="outlined" color="inherit" onClick={onGiveUp} sx={{ textTransform: 'none' }}>
                    Show the room
                </Button>
            )}
        </Stack>
    );

    return (
        <Box role="status" aria-live="polite" data-testid="room-loading" data-mode={mode} sx={geek ? {
            position: 'absolute', top: 16, left: '50%', transform: 'translateX(-50%)', zIndex: 5,
            width: 'min(560px, calc(100% - 32px))', p: 2, borderRadius: 2, border: 1, borderColor: 'divider',
            bgcolor: 'background.paper', boxShadow: 8,
        } : {
            width: '100%', maxWidth: 440, mx: 'auto', px: 2, py: { xs: 3, sm: 5 },
        }}>
            <Typography variant={geek ? 'subtitle1' : 'h5'} component="h2" sx={{ fontWeight: 700, mb: geek ? 1.25 : 2.5 }}>
                {title}
            </Typography>
            <StepList steps={steps} now={now} timed={timed} dense={geek} />
            {note && (
                <Typography variant="body2" sx={{ color: 'text.secondary', mt: 2 }}>{note}</Typography>
            )}
            {actions}
            {geek && <EventLines lines={lines} />}
            {mode === 'default' && (
                <Stack spacing={1} sx={{ mt: 3 }} aria-hidden="true">
                    {[0, 1, 2, 3].map(row => (
                        <Stack key={row} direction="row" spacing={1.5} sx={{ alignItems: 'center' }}>
                            <Skeleton variant="rounded" width={44} height={44} />
                            <Box sx={{ flex: 1 }}>
                                <Skeleton width="60%" />
                                <Skeleton width="35%" />
                            </Box>
                        </Stack>
                    ))}
                </Stack>
            )}
        </Box>
    );
}

RoomLoading.propTypes = {
    master: PropTypes.object.isRequired,
    mode: PropTypes.oneOf(['simple', 'default', 'geek']),
    roomName: PropTypes.string,
    onGiveUp: PropTypes.func,
};
