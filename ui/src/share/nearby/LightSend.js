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

export const LIGHT_SEND_HELP = 'On the other phone: open the room menu, then "Get a photo by camera". Point its camera at these codes. No network is necessary.';
export const NOT_HERE = 'This photo is not on this phone in full. Wait until it is here.';
export const TOO_LARGE = 'This file is too large to send by camera.';

/**
 * Shows one photo as a stream of codes for another phone's camera. The
 * codes never end: the other phone says when it has the photo.
 */
export default function LightSend({ master, tile, open, onClose }) {
    const canvasRef = useRef(null);
    const [levelId, setLevelId] = useState(DEFAULT_LEVEL);
    const [file, setFile] = useState(null);
    const [problem, setProblem] = useState('');
    const [rate, setRate] = useState(null);
    const level = LIGHT_LEVELS.find(each => each.id === levelId);

    // The photo's bytes, as the torrent carries them.
    useEffect(() => {
        if (!open) return undefined;
        let gone = false;
        setFile(null);
        setProblem('');
        Promise.resolve(master.findPhotoBytes?.(tile.infoHash))
            .then(async (blob) => {
                if (gone) return;
                if (!blob) setProblem(NOT_HERE);
                else if (blob.size > MAX_LIGHT_BYTES) setProblem(TOO_LARGE);
                else {
                    const bytes = new Uint8Array(await blob.arrayBuffer());
                    // Another photo may be open by now.
                    if (!gone) setFile(bytes);
                }
            })
            .catch((err) => {
                Logger.warn('Reading the photo for the camera transfer failed: ' + (err?.message || err));
                if (!gone) setProblem(NOT_HERE);
            });
        return () => { gone = true; };
    }, [open, master, tile.infoHash]);

    // Show the codes, one after the other, at the level's pace.
    useEffect(() => {
        if (!open || !file) return undefined;
        const sender = createLightSender(
            { id: tile.infoHash, name: tile.fileName || 'photo', type: tile.fileType || '', sealed: !!tile.secure },
            file, level.frameBytes);
        const startedAt = Date.now();
        let stopped = false;
        let timer = null;
        let shown = 0;
        let windowStart = performance.now();
        let windowShown = 0;
        notePairing(master.emitter, {
            channel: 'light', direction: 'out', what: 'photo', bytes: file.length,
            detail: `${level.frameBytes} B codes · ${level.fps}/s`,
        });
        const step = async () => {
            const due = performance.now() + 1000 / level.fps;
            try {
                const symbol = await qrSymbol(sender.next());
                if (stopped) return;
                if (canvasRef.current) drawSymbol(canvasRef.current, symbol);
                shown++;
                windowShown++;
                const now = performance.now();
                if (now - windowStart >= 1000) {
                    setRate({ fps: windowShown * 1000 / (now - windowStart), shown });
                    windowStart = now;
                    windowShown = 0;
                }
            } catch (err) {
                Logger.warn('Making a code failed: ' + (err?.message || err));
                if (!stopped) setProblem("Couldn't make the codes. Check your connection and try again.");
                return;
            }
            timer = setTimeout(step, Math.max(0, due - performance.now()));
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
    }, [open, file, level, tile, master.emitter]);

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
                                ? `${tile.fileName || 'Photo'} · ${FileUtil.formatBytes(file.length)} · ${sendTimeText(file.length, level)}`
                                    + (actual ? ` · ${FileUtil.formatBytes(actual)}/s` : '')
                                : 'Getting the photo ready…'}
                        </Typography>
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
                            <Typography variant="caption" sx={{ color: '#555' }}>
                                If the other phone reads few codes, use a slower speed.
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
