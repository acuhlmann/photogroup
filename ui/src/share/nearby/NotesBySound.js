import React, { useState, useEffect, useRef, useCallback } from 'react';
import PropTypes from 'prop-types';
import Dialog from '@mui/material/Dialog';
import DialogTitle from '@mui/material/DialogTitle';
import DialogContent from '@mui/material/DialogContent';
import IconButton from '@mui/material/IconButton';
import Stack from '@mui/material/Stack';
import Button from '@mui/material/Button';
import Typography from '@mui/material/Typography';
import FormControlLabel from '@mui/material/FormControlLabel';
import Switch from '@mui/material/Switch';
import CloseRounded from '@mui/icons-material/CloseRounded';
import VolumeUpRounded from '@mui/icons-material/VolumeUpRounded';
import StopRounded from '@mui/icons-material/StopRounded';
import HearingRounded from '@mui/icons-material/HearingRounded';
import Logger from 'js-logger';
import { notesText, parseNotesText, photoMark } from './notes';
import { canListen, canPlaySound, listenForText, playText } from './soundModem';
import { QUIET_LABEL } from './NearbyInvite';
import { MIC_ERROR } from './SoundListen';
import { notePairing } from './pairingLog';

export const NOTES_TITLE = 'Send small changes by sound';
export const NOTES_WHAT = 'The sound carries your name, the star ratings that the server did not get, and the list of photos on this phone. It does not carry photos.';
export const NOTES_HELP = 'On the other phones: open the room menu, then "Send small changes by sound", then tap "Listen". Hold the phones near this one. Turn the volume up.';
export const NOTES_OTHER_ROOM = 'That sound is from a different room. It was not used.';
const PLAY_ERROR = "Couldn't play the sound.";

/** What one phone told this phone, each fact as one sentence. */
export function heardLines(person, roomMarks) {
    const name = person.name || 'A phone near you';
    const lines = [];
    if (person.names) lines.push(`${name}: the name is here.`);
    if (person.ratings) lines.push(`${name}: ${person.ratings} star rating${person.ratings === 1 ? '' : 's'} received.`);
    if (person.marks?.size) {
        const count = roomMarks.filter(mark => person.marks.has(mark)).length;
        lines.push(`${name} has ${count} of the ${roomMarks.length} photos of this room.`);
    }
    return lines.length ? lines : [`${name}: nothing new.`];
}

/**
 * Small changes for the phones nearby when the network is weak: this phone
 * plays them as sound, or listens for the sound of another phone.
 */
export default function NotesBySound({ master, open, onClose }) {
    const notes = master.nearbyNotes;
    const [mode, setMode] = useState('idle'); // idle, playing, listening
    const [quiet, setQuiet] = useState(false);
    const [seconds, setSeconds] = useState(0);
    const [problem, setProblem] = useState('');
    const [heard, setHeard] = useState([]); // { from, name, names, ratings, marks }
    const [held, setHeld] = useState(() => notes.count());
    const playerRef = useRef(null);
    const listenerRef = useRef(null);
    const startRef = useRef(0);

    useEffect(() => {
        const onHeld = count => setHeld(count);
        master.emitter.on('heldChanges', onHeld);
        return () => master.emitter.removeListener('heldChanges', onHeld);
    }, [master]);

    const stop = useCallback(() => {
        startRef.current++;
        playerRef.current?.stop();
        playerRef.current = null;
        listenerRef.current?.abort();
        listenerRef.current = null;
        setMode('idle');
    }, []);

    useEffect(() => () => {
        startRef.current++;
        playerRef.current?.stop();
        listenerRef.current?.abort();
    }, []);

    const play = useCallback(async (useQuiet) => {
        stop();
        const mine = ++startRef.current;
        setProblem('');
        setMode('playing');
        try {
            let have = [];
            let frames = [];
            // The list of photos takes a moment to read. The sound must be
            // unlocked now, while the tap still counts: playText does that
            // before it waits for the text.
            const texts = master.heldPhotoIds().catch(() => []).then((ids) => {
                have = ids;
                frames = notes.frames({ have });
                return frames.map(notesText);
            });
            texts.catch(() => {});
            const player = await playText(texts, { quiet: useQuiet });
            if (mine !== startRef.current) {
                player.stop();
                return;
            }
            playerRef.current = player;
            setSeconds(Math.ceil(player.seconds));
            notePairing(master.emitter, {
                channel: 'sound', direction: 'out', what: 'notes',
                bytes: frames.reduce((sum, frame) => sum + frame.length, 0), ms: Math.round(player.seconds * 1000),
                detail: `${have.length} photos listed · ${useQuiet ? 'ultrasound' : 'audible'}`,
            });
        } catch (err) {
            Logger.warn('Playing the notes failed: ' + (err?.message || err));
            if (mine !== startRef.current) return;
            setMode('idle');
            setProblem(PLAY_ERROR);
        }
    }, [master, notes, stop]);

    const listen = useCallback(async () => {
        stop();
        const mine = ++startRef.current;
        setProblem('');
        setMode('listening');
        const controller = new AbortController();
        listenerRef.current = controller;
        const startedAt = Date.now();
        try {
            const listener = await listenForText({
                signal: controller.signal,
                onText: (text) => {
                    const frame = parseNotesText(text);
                    const result = frame && notes.apply(frame);
                    if (!result || result.own) return;
                    if (result.otherRoom) {
                        setProblem(NOTES_OTHER_ROOM);
                        return;
                    }
                    setProblem('');
                    notePairing(master.emitter, {
                        channel: 'sound', direction: 'in', what: 'notes', bytes: frame.length, ms: Date.now() - startedAt,
                        detail: result.name || '',
                    });
                    setHeard((before) => {
                        const known = before.find(person => person.from === result.from) || { from: result.from, names: 0, ratings: 0 };
                        const person = {
                            ...known,
                            name: result.name,
                            names: known.names + result.names,
                            ratings: known.ratings + result.ratings,
                            marks: notes.nearby.get(result.from)?.marks,
                        };
                        return [...before.filter(each => each.from !== result.from), person];
                    });
                },
            });
            if (mine !== startRef.current) {
                listener.stop();
                return;
            }
            controller.signal.addEventListener('abort', () => listener.stop(), { once: true });
        } catch (err) {
            if (controller.signal.aborted) return;
            Logger.warn('Listening for notes failed: ' + (err?.message || err));
            setMode('idle');
            setProblem(MIC_ERROR);
        }
    }, [master, notes, stop]);

    const toggleQuiet = (event) => {
        const next = event.target.checked;
        setQuiet(next);
        if (mode === 'playing') play(next);
    };

    const roomMarks = (master.roomPhotos?.all() || []).map(photo => photoMark(photo.infoHash));

    return (
        <Dialog open={open} onClose={onClose} maxWidth="xs" fullWidth aria-labelledby="notes-sound-title">
            <DialogTitle id="notes-sound-title" sx={{ pr: 6 }}>{NOTES_TITLE}</DialogTitle>
            <IconButton aria-label="Close" onClick={onClose} sx={{ position: 'absolute', right: 8, top: 8 }}>
                <CloseRounded />
            </IconButton>
            <DialogContent>
                <Stack spacing={1.5} sx={{ alignItems: 'center', textAlign: 'center' }}>
                    <Typography variant="body2">{NOTES_WHAT}</Typography>
                    {held > 0 && (
                        <Typography variant="body2" data-testid="held-changes" sx={{ fontWeight: 600 }}>
                            {`${held} change${held === 1 ? '' : 's'} of yours wait${held === 1 ? 's' : ''} for the server.`}
                        </Typography>
                    )}
                    <Stack direction="row" spacing={1}>
                        {canPlaySound() && (
                            <Button
                                variant={mode === 'playing' ? 'contained' : 'outlined'}
                                startIcon={mode === 'playing' ? <StopRounded /> : <VolumeUpRounded />}
                                onClick={mode === 'playing' ? stop : () => play(quiet)}
                                sx={{ textTransform: 'none' }}
                            >
                                {mode === 'playing' ? 'Stop the sound' : 'Send'}
                            </Button>
                        )}
                        {canListen() && (
                            <Button
                                variant={mode === 'listening' ? 'contained' : 'outlined'}
                                startIcon={mode === 'listening' ? <StopRounded /> : <HearingRounded />}
                                onClick={mode === 'listening' ? stop : listen}
                                sx={{ textTransform: 'none' }}
                            >
                                {mode === 'listening' ? 'Stop' : 'Listen'}
                            </Button>
                        )}
                    </Stack>
                    {mode === 'playing' && (
                        <>
                            <Typography variant="body2" role="status" sx={{ color: 'text.secondary' }}>
                                {(seconds ? `The sound takes about ${seconds} seconds. Then it starts again. ` : '') + NOTES_HELP}
                            </Typography>
                            <FormControlLabel
                                control={<Switch size="small" checked={quiet} onChange={toggleQuiet} />}
                                label={<Typography variant="body2">{QUIET_LABEL}</Typography>}
                            />
                        </>
                    )}
                    {mode === 'listening' && (
                        <Typography variant="body2" role="status" sx={{ color: 'text.secondary' }}>
                            {heard.length ? 'Listening for more…' : 'Listening…'}
                        </Typography>
                    )}
                    {heard.map(person => heardLines(person, roomMarks).map(line => (
                        <Typography key={person.from + line} variant="body2" data-testid="heard-note">{line}</Typography>
                    )))}
                    {problem && <Typography variant="body2" role="alert" sx={{ color: 'error.main' }}>{problem}</Typography>}
                </Stack>
            </DialogContent>
        </Dialog>
    );
}

NotesBySound.propTypes = {
    master: PropTypes.object.isRequired,
    open: PropTypes.bool.isRequired,
    onClose: PropTypes.func.isRequired,
};
