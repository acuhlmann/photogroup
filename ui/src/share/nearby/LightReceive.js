import React, { useState, useEffect, useRef } from 'react';
import PropTypes from 'prop-types';
import Dialog from '@mui/material/Dialog';
import DialogTitle from '@mui/material/DialogTitle';
import DialogContent from '@mui/material/DialogContent';
import IconButton from '@mui/material/IconButton';
import Box from '@mui/material/Box';
import Typography from '@mui/material/Typography';
import LinearProgress from '@mui/material/LinearProgress';
import Button from '@mui/material/Button';
import ButtonBase from '@mui/material/ButtonBase';
import CheckCircleRounded from '@mui/icons-material/CheckCircleRounded';
import CloseRounded from '@mui/icons-material/CloseRounded';
import Logger from 'js-logger';
import FileUtil from '../util/FileUtil';
import { getSharedLightReceiver } from './lightFrames';
import { framesNeeded } from './fountain.js';
import { readQrBytes, prepareReader, qrSymbol, drawSymbol } from './qrCodec';
import { readSheet, readBundle, encodePick, fitsBundle } from './lightBundle';
import { LIGHT_LEVELS, DEFAULT_LEVEL, sendTimeText } from './lightSpeed';
import { notePairing } from './pairingLog';

export const RECEIVE_TITLE = 'Get photos by camera';
export const LIGHT_RECEIVE_HELP = 'On the other phone: tap "Send photos by camera". Point this camera at the codes so they fill the square. Hold both phones still, turn the other screen\'s brightness up, and keep glare off it.';
export const CHOOSE_TEXT = 'Tap the photos that you want.';
export const PICK_TEXT = 'Hold this code in front of the camera of the other phone. When its codes change, point this camera at them again.';
export const TOO_MANY = 'These photos are too large together. Choose fewer photos.';
export const CAMERA_ERROR = 'The camera is not available. Allow the camera for this page, then try again.';
const OUTCOME = {
    delivered: name => `${name} is here.`,
    already: name => `You have ${name} already.`,
    saved: name => `${name} is not in this room. It is saved on this phone.`,
    rejected: () => 'This is not the photo that the room has. It was not added.',
    unknown: () => 'This photo is from a different private room. It cannot be opened here.',
};
const plural = (count, word) => `${count} ${word}${count === 1 ? '' : 's'}`;

/** What became of the photos of one transfer, as sentences. */
export function outcomeLines(results) {
    if (results.length === 1) return [OUTCOME[results[0].how](results[0].name || 'The photo')];
    const count = how => results.filter(result => result.how === how).length;
    const lines = [];
    if (count('delivered')) lines.push(`${plural(count('delivered'), 'photo')} ${count('delivered') === 1 ? 'is' : 'are'} here.`);
    if (count('saved')) lines.push(`${plural(count('saved'), 'photo')} ${count('saved') === 1 ? 'is' : 'are'} saved on this phone.`);
    if (count('already')) lines.push(`You have ${plural(count('already'), 'photo')} already.`);
    if (count('rejected')) lines.push(`${plural(count('rejected'), 'photo')} ${count('rejected') === 1 ? 'was' : 'were'} not added.`);
    if (count('unknown')) lines.push(`${plural(count('unknown'), 'photo')} from a different private room cannot be opened here.`);
    return lines;
}

// A mixed code gives its blocks only near the end, all at once. So the
// part received is counted from the codes read.
export function receivedPart({ have, frames, blocks, done }) {
    if (done) return 1;
    return Math.min(0.99, Math.max(have / blocks, frames / framesNeeded(blocks)));
}

export const NO_CODES_TIP = 'No codes read yet. Fill the square with the other screen, turn its brightness up, and hold both phones still.';
export const STALLED_TIP = 'No new codes for a while. Hold both phones still, move a little farther apart, and shade any glare. Blocks already read are kept, so keep the other phone showing its codes on the same speed and this carries on. If it never moves, start the other phone again on “Slow and sure”.';

/**
 * What to say when the codes stop coming, or null while they flow. A stall
 * used to look like nothing at all: the percent froze and the person could
 * not tell a shaky hand from a dead camera.
 */
export function stallTip({ codes, msSinceFresh, msSinceStart }) {
    if (!codes && msSinceStart >= 6000) return NO_CODES_TIP;
    if (codes && msSinceFresh >= 5000) return STALLED_TIP;
    return null;
}

/** The reading so far, in words a person can act on. */
export function seenText({ codes, have, blocks, msSinceFresh }) {
    if (!codes) return '';
    const needed = framesNeeded(blocks);
    const ago = msSinceFresh == null ? '' : ` · last code ${Math.max(0, Math.round(msSinceFresh / 1000))}s ago`;
    return `${codes} of about ${needed} codes read · ${have} of ${blocks} blocks${ago}`;
}

export const DAMAGED = 'The codes did not give correct photos. Nothing was added. Start again on the other phone.';
export const ADD_FAILED = "Couldn't add the photo. Keep the camera on the codes to try again.";
const RETRY_MS = 3000;
// The camera picture is cut to a square this wide before it is read.
const READ_SIDE = 960;

/**
 * Reads a photo from the codes on another phone's screen and puts it in the
 * room, as if it came over the network.
 */
export default function LightReceive({ master, open, onClose }) {
    const videoRef = useRef(null);
    const [failed, setFailed] = useState(false);
    const [progress, setProgress] = useState(null);
    const [outcome, setOutcome] = useState('');
    const [view, setView] = useState('camera'); // camera, choose, pick
    const [sheet, setSheet] = useState(null);
    const [chosen, setChosen] = useState([]);
    const [cameraRun, setCameraRun] = useState(0);
    const [now, setNow] = useState(() => Date.now());
    const timingRef = useRef({ startedAt: Date.now(), lastFreshAt: null });
    const pickRef = useRef(null);

    useEffect(() => {
        if (!open) return undefined;
        const isRestart = cameraRun > 0;
        let stopped = false;
        let stream = null;
        let timer = null;
        let watchdog = null;
        // Kept by the page, not by this dialog: closing and reopening, or
        // the camera restarting below, carries on from the blocks read.
        const receiver = getSharedLightReceiver();
        const canvas = document.createElement('canvas');
        const context = canvas.getContext('2d', { willReadFrequently: true });
        let send = null; // { startedAt, freshBytes, read }
        let finished = false;
        let retryAt = 0;
        let restarting = false;
        const startedAt = Date.now();
        let lastReadyAt = startedAt;
        timingRef.current = { startedAt, lastFreshAt: null };
        setFailed(false);
        if (!isRestart) {
            setProgress(null);
            setOutcome('');
            setView('camera');
            setSheet(null);
        }
        // Show what a previous try already read, instead of 0%.
        const held = receiver.progress();
        if (held && !held.done) {
            send = { startedAt, read: held.frames, total: held.total, sendId: held.sendId };
            timingRef.current.lastFreshAt = startedAt;
            setProgress({
                part: receivedPart(held), codes: held.frames, have: held.have, blocks: held.blocks,
                total: held.total, rate: 0,
            });
        }
        const restartCamera = () => {
            if (stopped || restarting) return;
            restarting = true;
            Logger.warn('The camera stopped giving pictures; starting it again');
            setCameraRun(run => run + 1);
        };

        const finish = async (state) => {
            const result = receiver.result();
            const seconds = (Date.now() - send.startedAt) / 1000;
            if (!result) {
                // Nothing usable is held; a fresh stream must be able to start.
                receiver.reset();
                setOutcome(OUTCOME.rejected());
                return;
            }
            // The small pictures of some photos: the person picks.
            const sheet = readSheet(result);
            const kind = result.details?.kind;
            // Says that it is a sheet or a bundle, but is not a correct one:
            // not a photo, so nothing of it goes into the room.
            if ((kind === 'sheet' && !sheet) || (kind === 'bundle' && !readBundle(result))) {
                receiver.reset();
                if (!stopped) setOutcome(DAMAGED);
                return;
            }
            if (sheet) {
                receiver.reset();
                if (stopped) return;
                setSheet({ sendId: state.sendId, items: sheet.items.map(item => ({
                    ...item, url: item.thumb ? URL.createObjectURL(new Blob([item.thumb], { type: 'image/jpeg' })) : '',
                })) });
                setChosen([]);
                setView('choose');
                notePairing(master.emitter, {
                    channel: 'light', direction: 'in', what: 'small pictures', bytes: result.file.length,
                    ms: Math.round(seconds * 1000), detail: `${sheet.items.length} photos`,
                });
                return;
            }
            const parts = readBundle(result) || [result];
            const results = [];
            try {
                for (const part of parts) {
                    results.push({ name: part.details.name, how: await master.acceptNearbyPhoto(part.details, part.file) });
                }
            } catch (err) {
                // The file is whole: the next code read tries to add it again.
                Logger.warn('Adding the photo from the camera failed: ' + (err?.message || err));
                if (!stopped) setOutcome(ADD_FAILED);
                retryAt = Date.now() + RETRY_MS;
                finished = false;
                return;
            }
            if (stopped) return;
            // This photo is in; the next one starts from nothing.
            receiver.reset();
            setOutcome(outcomeLines(results).join(' '));
            notePairing(master.emitter, {
                channel: 'light', direction: 'in', what: 'photo', bytes: result.file.length,
                ms: Math.round(seconds * 1000),
                detail: `${FileUtil.formatBytes(result.file.length / Math.max(seconds, 0.1))}/s · ${state.blocks} blocks from ${send.read} codes`,
            });
        };

        const read = async () => {
            if (stopped) return;
            const video = videoRef.current;
            if (video && video.readyState >= 2 && video.videoWidth) {
                lastReadyAt = Date.now();
                const side = Math.min(video.videoWidth, video.videoHeight);
                const size = Math.min(side, READ_SIDE);
                canvas.width = size;
                canvas.height = size;
                context.drawImage(video, (video.videoWidth - side) / 2, (video.videoHeight - side) / 2, side, side, 0, 0, size, size);
                try {
                    const bytes = await readQrBytes(context.getImageData(0, 0, size, size));
                    const state = bytes && receiver.add(bytes);
                    if (state && !stopped) {
                        // Another photo came on screen: count again.
                        if (!send || send.sendId !== state.sendId || send.total !== state.total) {
                            send = { startedAt: Date.now(), read: 0, total: state.total, sendId: state.sendId };
                            retryAt = 0;
                            finished = false;
                            setOutcome('');
                            // The other phone read the choice: its codes carry the photos now.
                            setView('camera');
                        }
                        if (state.fresh) {
                            send.read++;
                            timingRef.current.lastFreshAt = Date.now();
                        }
                        if (!finished && !retryAt) {
                            const seconds = Math.max((Date.now() - send.startedAt) / 1000, 0.5);
                            const part = receivedPart(state);
                            setProgress({
                                part, codes: state.frames, have: state.have, blocks: state.blocks,
                                total: state.total, rate: part * state.total / seconds,
                            });
                        }
                        if (state.done && !finished && Date.now() >= retryAt) {
                            finished = true;
                            await finish(state);
                        }
                    }
                } catch (err) {
                    // A failed read is one frame lost, not the end: the
                    // loop below is always rescheduled.
                    Logger.warn('Reading a code failed: ' + (err?.message || err));
                }
            }
            if (stopped) return;
            // As fast as the reader goes, with a pause for the page.
            timer = setTimeout(read, 4);
        };

        // The watchdog: a track that ended, or a picture that stopped
        // arriving (the phone switched apps, another app took the camera),
        // restarts the camera instead of leaving a frozen view. The blocks
        // already read are kept either way.
        watchdog = setInterval(() => {
            const tracks = stream?.getVideoTracks() || [];
            if (tracks.length && tracks.every(track => track.readyState === 'ended')) restartCamera();
            else if (stream && Date.now() - lastReadyAt > 9000) restartCamera();
        }, 2000);

        (async () => {
            try {
                const ready = prepareReader();
                stream = await navigator.mediaDevices.getUserMedia({
                    audio: false,
                    video: { facingMode: 'environment', width: { ideal: 1280 }, height: { ideal: 720 }, frameRate: { ideal: 30 } },
                });
                await ready;
                if (stopped) {
                    stream.getTracks().forEach(track => track.stop());
                    return;
                }
                const video = videoRef.current;
                video.srcObject = stream;
                stream.getVideoTracks().forEach(track => track.addEventListener('ended', restartCamera));
                await video.play().catch(() => {});
                read();
            } catch (err) {
                Logger.warn('Starting the camera failed: ' + (err?.message || err));
                stream?.getTracks().forEach(track => track.stop());
                if (!stopped) setFailed(true);
            }
        })();

        return () => {
            stopped = true;
            clearTimeout(timer);
            clearInterval(watchdog);
            stream?.getTracks().forEach(track => track.stop());
        };
    }, [open, master, cameraRun]);

    // Once a second: how long since the last new code, for the stall tip.
    useEffect(() => {
        if (!open) return undefined;
        const ticker = setInterval(() => setNow(Date.now()), 1000);
        return () => clearInterval(ticker);
    }, [open ]);

    const percent = progress ? Math.floor(progress.part * 100) : 0;
    const msSinceFresh = timingRef.current.lastFreshAt ? now - timingRef.current.lastFreshAt : null;
    const tip = !outcome && !failed ? stallTip({
        codes: progress?.codes || 0,
        msSinceFresh: msSinceFresh ?? Number.POSITIVE_INFINITY,
        msSinceStart: now - timingRef.current.startedAt,
    }) : null;
    const seen = progress && !outcome ? seenText({
        codes: progress.codes, have: progress.have ?? 0, blocks: progress.blocks ?? progress.codes,
        msSinceFresh,
    }) : '';

    // The small pictures are freed when another sheet comes or this closes.
    useEffect(() => () => { sheet?.items.forEach((item) => { if (item.url) URL.revokeObjectURL(item.url); }); }, [sheet]);

    // The code that carries the choice.
    useEffect(() => {
        if (view !== 'pick' || !sheet) return undefined;
        let gone = false;
        qrSymbol(encodePick(sheet.sendId, chosen)).then((symbol) => {
            if (!gone && pickRef.current) drawSymbol(pickRef.current, symbol);
        }).catch(err => Logger.warn('Making a code failed: ' + (err?.message || err)));
        return () => { gone = true; };
    }, [view, sheet, chosen]);

    const toggle = index => setChosen(before => (before.includes(index) ? before.filter(each => each !== index) : [...before, index]));
    const chosenBytes = sheet ? chosen.reduce((sum, index) => sum + sheet.items[index].size, 0) : 0;
    const tooMany = sheet ? !fitsBundle(chosen.map(index => sheet.items[index].size)) : false;
    const level = LIGHT_LEVELS.find(each => each.id === DEFAULT_LEVEL);

    return (
        <Dialog open={open} onClose={onClose} fullScreen aria-labelledby="light-receive-title">
            <DialogTitle id="light-receive-title" sx={{ textAlign: 'center', px: 6 }}>{RECEIVE_TITLE}</DialogTitle>
            <IconButton aria-label="Close" onClick={onClose} sx={{ position: 'absolute', right: 8, top: 8 }}>
                <CloseRounded />
            </IconButton>
            <DialogContent sx={{ display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 1.5 }}>
                {failed ? (
                    <Typography role="alert" sx={{ py: 4, textAlign: 'center' }}>{CAMERA_ERROR}</Typography>
                ) : (
                    <>
                        {/* The camera stays on while the person picks: it sees when the photos come. */}
                        <Box sx={view === 'camera' ? { display: 'contents' }
                            : { position: 'absolute', width: 2, height: 2, overflow: 'hidden', opacity: 0, pointerEvents: 'none' }}>
                            <Box sx={{ width: 'min(100%, 56vh)', aspectRatio: '1', borderRadius: 2, overflow: 'hidden', bgcolor: '#000', flexShrink: 0 }}>
                                <video ref={videoRef} muted playsInline style={{ width: '100%', height: '100%', objectFit: 'cover', display: 'block' }} />
                            </Box>
                            <Box sx={{ width: '100%', maxWidth: 420 }}>
                                <LinearProgress variant="determinate" value={percent} aria-label="Photo received" sx={{ height: 8, borderRadius: 4 }} />
                            </Box>
                            <Typography variant="body1" role="status" data-testid="light-progress" data-codes={progress?.codes || 0} sx={{ fontWeight: 600, fontVariantNumeric: 'tabular-nums', textAlign: 'center' }}>
                                {outcome || (progress
                                    ? `${percent}% of ${FileUtil.formatBytes(progress.total)} · ${FileUtil.formatBytes(progress.rate)}/s`
                                    : 'Looking for codes…')}
                            </Typography>
                            {seen && (
                                <Typography variant="body2" data-testid="light-seen" sx={{ color: 'text.secondary', fontVariantNumeric: 'tabular-nums', textAlign: 'center' }}>
                                    {seen}
                                </Typography>
                            )}
                            <Typography variant="body2" sx={{ color: 'text.secondary', textAlign: 'center', maxWidth: 420 }}>
                                {tip || (outcome && outcome !== ADD_FAILED ? 'Point the camera at the next photos, or close this.' : LIGHT_RECEIVE_HELP)}
                            </Typography>
                            {sheet && (
                                <Button size="small" onClick={() => setView('choose')} sx={{ textTransform: 'none' }}>Choose again</Button>
                            )}
                        </Box>
                        {view === 'choose' && sheet && (
                            <>
                                <Typography variant="body1" role="status" sx={{ fontWeight: 600, textAlign: 'center' }}>{CHOOSE_TEXT}</Typography>
                                <Box data-testid="light-sheet" sx={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(104px, 1fr))', gap: 1, width: '100%', maxWidth: 560 }}>
                                    {sheet.items.map((item, index) => {
                                        const on = chosen.includes(index);
                                        return (
                                            <ButtonBase
                                                key={item.id + index} onClick={() => toggle(index)} aria-pressed={on}
                                                aria-label={`${item.name}, ${FileUtil.formatBytes(item.size)}`}
                                                sx={{
                                                    position: 'relative', display: 'flex', flexDirection: 'column', alignItems: 'stretch', borderRadius: 1.5,
                                                    overflow: 'hidden', border: '2px solid', borderColor: on ? 'primary.main' : 'divider', bgcolor: 'background.paper',
                                                }}
                                            >
                                                <Box sx={{ aspectRatio: '1', bgcolor: 'action.hover', display: 'grid', placeItems: 'center' }}>
                                                    {item.url
                                                        ? <img src={item.url} alt="" style={{ width: '100%', height: '100%', objectFit: 'cover', display: 'block' }} />
                                                        : <Typography variant="caption" sx={{ color: 'text.secondary', px: 0.5 }}>{item.sealed ? 'Private' : 'No picture'}</Typography>}
                                                </Box>
                                                <Typography variant="caption" title={item.name} sx={{ px: 0.5, pt: 0.25, whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>
                                                    {item.name}
                                                </Typography>
                                                <Typography variant="caption" sx={{ px: 0.5, pb: 0.25, color: 'text.secondary', whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>
                                                    {FileUtil.formatBytes(item.size)}
                                                </Typography>
                                                {on && <CheckCircleRounded color="primary" sx={{ position: 'absolute', top: 4, right: 4, bgcolor: '#fff', borderRadius: '50%' }} />}
                                            </ButtonBase>
                                        );
                                    })}
                                </Box>
                                <Typography variant="body2" role="status" data-testid="light-chosen" sx={{ textAlign: 'center', color: tooMany ? 'error.main' : 'text.secondary', fontVariantNumeric: 'tabular-nums' }}>
                                    {tooMany ? TOO_MANY : chosen.length
                                        ? `${plural(chosen.length, 'photo')} · ${FileUtil.formatBytes(chosenBytes)} · ${sendTimeText(chosenBytes, level)}`
                                        : 'A photo by camera can take minutes. Choose few photos.'}
                                </Typography>
                                <Button variant="contained" disabled={!chosen.length || tooMany} onClick={() => setView('pick')} sx={{ textTransform: 'none' }}>
                                    Get these photos
                                </Button>
                            </>
                        )}
                        {view === 'pick' && sheet && (
                            <>
                                <Box sx={{ bgcolor: '#fff', p: '4vmin', width: 'min(90vw, 52vh)', aspectRatio: '1', flexShrink: 0, borderRadius: 2 }}>
                                    <canvas ref={pickRef} data-testid="pick-code" aria-label="Code with your choice"
                                        style={{ width: '100%', height: '100%', imageRendering: 'pixelated', display: 'block' }} />
                                </Box>
                                <Typography variant="body1" role="status" sx={{ fontWeight: 600, textAlign: 'center', maxWidth: 420 }}>{PICK_TEXT}</Typography>
                                <Button variant="contained" onClick={() => setView('camera')} sx={{ textTransform: 'none' }}>The other phone has my choice</Button>
                                <Button size="small" onClick={() => setView('choose')} sx={{ textTransform: 'none' }}>Choose again</Button>
                            </>
                        )}
                    </>
                )}
            </DialogContent>
        </Dialog>
    );
}

LightReceive.propTypes = {
    master: PropTypes.object.isRequired,
    open: PropTypes.bool.isRequired,
    onClose: PropTypes.func.isRequired,
};
