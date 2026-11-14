import React, { useState, useEffect, useRef } from 'react';
import PropTypes from 'prop-types';
import Box from '@mui/material/Box';
import Stack from '@mui/material/Stack';
import Typography from '@mui/material/Typography';
import LinearProgress from '@mui/material/LinearProgress';
import HearingRounded from '@mui/icons-material/HearingRounded';
import Logger from 'js-logger';
import { parseRoomCode } from './roomCode';
import { listenForText } from './soundModem';

export const LISTEN_HELP = 'Hold this phone near the phone that plays the sound.';
export const MIC_ERROR = 'The microphone is not available. Allow the microphone for this page, then try again.';

/** Listens on the microphone for a room code while it is on screen. */
export default function SoundListen({ onCode }) {
    const [level, setLevel] = useState(0);
    const [state, setState] = useState('starting');
    const onCodeRef = useRef(onCode);
    onCodeRef.current = onCode;

    useEffect(() => {
        let listener = null;
        let ended = false;
        const startedAt = Date.now();
        const starting = new AbortController();
        listenForText({
            signal: starting.signal,
            onLevel: value => { if (!ended) setLevel(value); },
            onText: (text) => {
                const code = parseRoomCode(text);
                if (!code || ended) return;
                ended = true;
                listener?.stop();
                setState('heard');
                onCodeRef.current(code, { bytes: text.length, ms: Date.now() - startedAt });
            },
        }).then((started) => {
            if (ended) {
                started.stop();
                return;
            }
            listener = started;
            setState('listening');
        }).catch((err) => {
            Logger.warn('Listening for a room code failed: ' + (err?.message || err));
            if (!ended) setState('failed');
        });
        return () => {
            ended = true;
            starting.abort();
            listener?.stop();
        };
    }, []);

    if (state === 'failed') {
        return <Typography variant="body2" role="alert" sx={{ textAlign: 'center', py: 3 }}>{MIC_ERROR}</Typography>;
    }

    return (
        <Stack spacing={2} sx={{ alignItems: 'center', textAlign: 'center', py: 3 }}>
            <Box sx={{
                width: 96, height: 96, borderRadius: '50%',
                display: 'flex', alignItems: 'center', justifyContent: 'center',
                bgcolor: 'var(--accent-soft)', color: 'primary.main',
                transform: `scale(${1 + level * 0.35})`,
                transition: 'transform 120ms linear',
            }}>
                <HearingRounded sx={{ fontSize: 44 }} />
            </Box>
            <Typography variant="body1" role="status" sx={{ fontWeight: 600 }}>
                {state === 'heard' ? 'Room found. Joining…' : state === 'listening' ? 'Listening…' : 'Starting the microphone…'}
            </Typography>
            <Box sx={{ width: '100%', maxWidth: 240 }}>
                <LinearProgress variant="determinate" value={Math.round(level * 100)} aria-label="Sound level" />
            </Box>
            <Typography variant="body2" sx={{ color: 'text.secondary' }}>{LISTEN_HELP}</Typography>
        </Stack>
    );
}

SoundListen.propTypes = {
    onCode: PropTypes.func.isRequired,
};
