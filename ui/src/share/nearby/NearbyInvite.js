import React, { useState, useEffect, useRef, useCallback } from 'react';
import PropTypes from 'prop-types';
import Stack from '@mui/material/Stack';
import Button from '@mui/material/Button';
import Typography from '@mui/material/Typography';
import FormControlLabel from '@mui/material/FormControlLabel';
import Switch from '@mui/material/Switch';
import VolumeUpRounded from '@mui/icons-material/VolumeUpRounded';
import StopRounded from '@mui/icons-material/StopRounded';
import NfcRounded from '@mui/icons-material/NfcRounded';
import Logger from 'js-logger';
import { roomCodeText } from './roomCode';
import { canPlaySound, playText } from './soundModem';
import { canWriteNfc, writeLinkToTag } from './nfcTag';
import { notePairing } from './pairingLog';

export const SOUND_HELP = 'On the other phones: tap "Scan to join", then "Listen for the sound instead". Hold the phones near this one. Turn the volume up.';
export const QUIET_LABEL = 'Use a high sound that most people cannot hear';
const NFC_TEXT = {
    waiting: 'Hold an NFC tag to the back of this phone.',
    done: 'The tag has the link. A phone that taps the tag opens the room.',
    failed: 'Cannot write to this tag. Try a different tag.',
};

/**
 * Two more ways to give the room to phones nearby: play the code as sound
 * (all phones that listen join at once), or write the link to an NFC tag.
 */
export default function NearbyInvite({ master, room, roomKey = null, url }) {
    const [playing, setPlaying] = useState(false);
    const [quiet, setQuiet] = useState(false);
    const [nfc, setNfc] = useState('');
    const playerRef = useRef(null);
    const nfcRef = useRef(null);
    const text = roomCodeText({ room, key: roomKey });

    const stopSound = useCallback(() => {
        playerRef.current?.stop();
        playerRef.current = null;
        setPlaying(false);
    }, []);

    const startSound = useCallback(async (useQuiet) => {
        playerRef.current?.stop();
        playerRef.current = null;
        setPlaying(true);
        try {
            const player = await playText(text, { quiet: useQuiet });
            playerRef.current = player;
            notePairing(master.emitter, {
                channel: 'sound',
                direction: 'out',
                bytes: text.length,
                ms: Math.round(player.seconds * 1000),
                detail: useQuiet ? 'ultrasound' : 'audible',
            });
        } catch (err) {
            Logger.warn('Playing the room code failed: ' + (err?.message || err));
            setPlaying(false);
            master.emitter.emit('showError', "Couldn't play the sound. Let them scan the code instead.");
        }
    }, [text, master.emitter]);

    const toggleQuiet = (event) => {
        const next = event.target.checked;
        setQuiet(next);
        if (playing) startSound(next);
    };

    const writeTag = useCallback(async () => {
        nfcRef.current?.abort();
        const controller = new AbortController();
        nfcRef.current = controller;
        setNfc('waiting');
        try {
            const bytes = await writeLinkToTag(url, { signal: controller.signal });
            setNfc('done');
            notePairing(master.emitter, { channel: 'nfc', direction: 'out', bytes });
        } catch (err) {
            if (controller.signal.aborted) return;
            Logger.warn('Writing the NFC tag failed: ' + (err?.message || err));
            setNfc('failed');
        }
    }, [url, master.emitter]);

    // The sound and the wait for a tag end with the invite.
    useEffect(() => () => {
        playerRef.current?.stop();
        nfcRef.current?.abort();
    }, []);

    const sound = !!text && canPlaySound();
    const tag = canWriteNfc();
    if (!sound && !tag) return null;

    return (
        <Stack spacing={0.5} sx={{ alignItems: 'center', textAlign: 'center' }}>
            {sound && (
                <Button
                    size="small"
                    startIcon={playing ? <StopRounded /> : <VolumeUpRounded />}
                    onClick={playing ? stopSound : () => startSound(quiet)}
                    sx={{ textTransform: 'none' }}
                >
                    {playing ? 'Stop the sound' : 'Send the code by sound'}
                </Button>
            )}
            {sound && playing && (
                <>
                    <Typography variant="body2" role="status" sx={{ color: 'text.secondary', maxWidth: 340 }}>
                        {SOUND_HELP}
                    </Typography>
                    <FormControlLabel
                        control={<Switch size="small" checked={quiet} onChange={toggleQuiet} />}
                        label={<Typography variant="body2">{QUIET_LABEL}</Typography>}
                    />
                    {quiet && (
                        <Typography variant="caption" sx={{ color: 'text.secondary' }}>
                            Some phones cannot play or hear this sound.
                        </Typography>
                    )}
                </>
            )}
            {tag && (
                <Button size="small" startIcon={<NfcRounded />} onClick={writeTag} sx={{ textTransform: 'none' }}>
                    Write the link to an NFC tag
                </Button>
            )}
            {tag && nfc && (
                <Typography variant="body2" role="status" sx={{ color: nfc === 'failed' ? 'error.main' : 'text.secondary', maxWidth: 340 }}>
                    {NFC_TEXT[nfc]}
                </Typography>
            )}
        </Stack>
    );
}

NearbyInvite.propTypes = {
    master: PropTypes.object.isRequired,
    room: PropTypes.string.isRequired,
    roomKey: PropTypes.string,
    url: PropTypes.string.isRequired,
};
