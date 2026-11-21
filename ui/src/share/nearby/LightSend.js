import React, { useState, useEffect, useRef } from 'react';
import PropTypes from 'prop-types';
import Dialog from '@mui/material/Dialog';
import DialogTitle from '@mui/material/DialogTitle';
import DialogContent from '@mui/material/DialogContent';
import IconButton from '@mui/material/IconButton';
import Box from '@mui/material/Box';
import Stack from '@mui/material/Stack';
import Typography from '@mui/material/Typography';
import ToggleButton from '@mui/material/ToggleButton';
import ToggleButtonGroup from '@mui/material/ToggleButtonGroup';
import CloseRounded from '@mui/icons-material/CloseRounded';
import Logger from 'js-logger';
import FileUtil from '../util/FileUtil';
import { createLightSender, MAX_LIGHT_BYTES } from './lightFrames';
import { qrSymbol, drawSymbol } from './qrCodec';
import { LIGHT_LEVELS, DEFAULT_LEVEL, sendTimeText } from './lightSpeed';
import { notePairing } from './pairingLog';
import { canBeSmall, makeSmall, SMALL_MAX_BYTES } from './lightBundle';
import SizeChoice from './SizeChoice';

export const LIGHT_SEND_HELP = 'On the other phone: open the room menu, then "Get photos by camera". Point its camera at these codes. No network is necessary. The codes keep going until you close this, and a second try carries on where the first left off.';
export const CODE_FAILED = "Couldn't make a code. Trying again…";
export const NOT_HERE = 'This photo is not on this phone in full. Wait until it is here.';
export const TOO_LARGE = 'This file is too large to send by camera.';

/**
 * Shows one photo as a stream of codes for another phone's camera. The
 * codes never end: the other phone says when it has the photo. A photo or
 * video goes in small size first (fast); the person can change to full size.
 */
export default function LightSend({ master, tile, open, onClose }) {
    const canvasRef = useRef(null);
    const [levelId, setLevelId] = useState(DEFAULT_LEVEL);
    // { full, small, canSmall }: full is null when it is too large for a camera transfer.
    const [ready, setReady] = useState(null);
    const [size, setSize] = useState('small');
    const [problem, setProblem] = useState('');
    const [rate, setRate] = useState(null);
    const level = LIGHT_LEVELS.find(each => each.id === levelId);

    // The photo's bytes, as the torrent carries them, and the photo in small size.
    useEffect(() => {
        if (!open) return undefined;
        let gone = false;
        setReady(null);
        setProblem('');
        Promise.resolve(master.findPhotoBytes?.(tile.infoHash))
            .then(async (blob) => {
                if (gone) return;
                if (!blob) {
                    setProblem(NOT_HERE);
                    return;
                }
                const type = tile.fileType || blob.type || '';
                const canSmall = canBeSmall({ type, sealed: !!tile.secure }) && blob.size > SMALL_MAX_BYTES;
                const tooLarge = blob.size > MAX_LIGHT_BYTES;
                if (tooLarge && !canSmall) {
                    setProblem(TOO_LARGE);
                    return;
                }
                const full = tooLarge ? null : new Uint8Array(await blob.arrayBuffer());
                const small = canSmall ? await makeSmall(new Blob([blob], { type })) : null;
                // Another photo may be open by now.
                if (gone) return;
                if (!full && !small) setProblem(TOO_LARGE);
                else setReady({ full, small, canSmall: !!small });
            })
            .catch((err) => {
                Logger.warn('Reading the photo for the camera transfer failed: ' + (err?.message || err));
                if (!gone) setProblem(NOT_HERE);
            });
        return () => { gone = true; };
    }, [open, master, tile.infoHash, tile.fileType, tile.secure]);

    const inSmall = !!ready?.small && (size === 'small' || !ready.full);
    const file = ready ? (inSmall ? ready.small : ready.full) : null;

    // Show the codes, one after the other, at the level's pace.
    useEffect(() => {
        if (!open || !file) return undefined;
        const sender = createLightSender(
            {
                id: tile.infoHash, name: tile.fileName || 'photo', type: tile.fileType || '', sealed: !!tile.secure,
                ...(inSmall ? { small: true } : {}),
            },
            file, level.frameBytes);
        const startedAt = Date.now();
        let stopped = false;
        let timer = null;
        let shown = 0;
        let windowStart = performance.now();
        let windowShown = 0;
        notePairing(master.emitter, {
            channel: 'light', direction: 'out', what: inSmall ? 'photo in small size' : 'photo', bytes: file.length,
            detail: `${level.frameBytes} B codes · ${level.fps}/s`,
        });
        const step = async () => {
            const due = performance.now() + 1000 / level.fps;
            try {
                const symbol = await qrSymbol(sender.next());
                if (stopped) return;
                if (canvasRef.current) drawSymbol(canvasRef.current, symbol);
                setProblem(before => (before === CODE_FAILED ? '' : before));
                shown++;
                windowShown++;
                const now = performance.now();
                if (now - windowStart >= 1000) {
                    setRate({ fps: windowShown * 1000 / (now - windowStart), shown });
                    windowStart = now;
                    windowShown = 0;
                }
            } catch (err) {
                // One failed code must not end the stream: the receiver
                // would sit at its last percent with no way to finish.
                Logger.warn('Making a code failed: ' + (err?.message || err));
                if (!stopped) setProblem(CODE_FAILED);
                if (!stopped) timer = setTimeout(step, 600);
                return;
            }
            if (!stopped) timer = setTimeout(step, Math.max(0, due - performance.now()));
        };
        step();
        // A dim or sleeping screen stops the transfer.
        let lock = null;
        navigator.wakeLock?.request('screen').then((held) => {
            if (stopped) held.release().catch(() => {});
            else lock = held;
        }).catch(() => {});
        return () => {
            stopped = true;
            clearTimeout(timer);
            lock?.release().catch(() => {});
            Logger.info(`Camera transfer: showed ${shown} codes in ${Math.round((Date.now() - startedAt) / 1000)} s`);
        };
    }, [open, file, inSmall, level, tile, master.emitter]);

    const actual = rate ? Math.round(rate.fps * (level.frameBytes - 20)) : null;

    return (
        <Dialog open={open} onClose={onClose} fullScreen aria-labelledby="light-send-title"
            slotProps={{ paper: { sx: { bgcolor: '#fff', color: '#111' } } }}>
            <DialogTitle id="light-send-title" sx={{ textAlign: 'center', px: 6, pb: 0.5 }}>
                Send by camera
            </DialogTitle>
            <IconButton aria-label="Close" onClick={onClose} sx={{ position: 'absolute', right: 8, top: 8, color: '#111' }}>
                <CloseRounded />
            </IconButton>
            <DialogContent sx={{ display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 1.5, pt: 1 }}>
                {problem ? (
                    <Typography role="alert" sx={{ py: 4, textAlign: 'center' }}>{problem}</Typography>
                ) : (
                    <>
                        {/* White around the code: a camera needs the quiet zone. */}
                        <Box sx={{ bgcolor: '#fff', p: '4vmin', width: 'min(96vw, 68vh)', aspectRatio: '1', flexShrink: 0 }}>
                            <canvas
                                ref={canvasRef}
                                data-testid="light-code"
                                aria-label="Codes that carry the photo"
                                style={{ width: '100%', height: '100%', imageRendering: 'pixelated', display: 'block' }}
                            />
                        </Box>
                        <Typography variant="body2" role="status" sx={{ fontVariantNumeric: 'tabular-nums', textAlign: 'center' }}>
                            {file
                                // With a size choice, the bytes and the time are on it.
                                ? (ready.canSmall
                                    ? `${tile.fileName || 'Photo'} in ${inSmall ? 'small' : 'full'} size`
                                    : `${tile.fileName || 'Photo'} · ${FileUtil.formatBytes(file.length)} · ${sendTimeText(file.length, level)}`)
                                    + (actual ? ` · ${FileUtil.formatBytes(actual)}/s` : '')
                                : 'Getting the photo ready…'}
                        </Typography>
                        {ready?.canSmall && (
                            <SizeChoice
                                light level={level} value={inSmall ? 'small' : 'full'} onChange={setSize}
                                smallBytes={ready.small.length} fullBytes={ready.full?.length ?? null}
                                onlySmall={!ready.full}
                            />
                        )}
                        <Stack spacing={0.5} sx={{ alignItems: 'center' }}>
                            <ToggleButtonGroup
                                exclusive size="small" value={levelId} aria-label="Speed"
                                onChange={(event, value) => { if (value) setLevelId(value); }}
                            >
                                {LIGHT_LEVELS.map(each => (
                                    <ToggleButton key={each.id} value={each.id} sx={{ textTransform: 'none', color: '#111' }}>
                                        {each.label}
                                    </ToggleButton>
                                ))}
                            </ToggleButtonGroup>
                            <Typography variant="caption" sx={{ color: '#555', textAlign: 'center', maxWidth: 420 }}>
                                Start with “Slow and sure” for a phone held in a hand. Change speed before
                                you start if you can: a new speed starts the other phone&apos;s count again.
                                Turn this screen&apos;s brightness up and keep the codes out of glare.
                            </Typography>
                        </Stack>
                        {(master.nearbyNotes?.whoHas(tile.infoHash) || []).map(name => (
                            <Typography key={name} variant="body2" sx={{ color: '#111', textAlign: 'center', fontWeight: 600 }}>
                                {`${name} has this photo already.`}
                            </Typography>
                        ))}
                        <Typography variant="body2" sx={{ color: '#444', textAlign: 'center', maxWidth: 420 }}>
                            {LIGHT_SEND_HELP}
                        </Typography>
                    </>
                )}
            </DialogContent>
        </Dialog>
    );
}

LightSend.propTypes = {
    master: PropTypes.object.isRequired,
    tile: PropTypes.object.isRequired,
    open: PropTypes.bool.isRequired,
    onClose: PropTypes.func.isRequired,
};
