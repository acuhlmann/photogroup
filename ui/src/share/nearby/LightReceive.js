import React, { useState, useEffect, useRef } from 'react';
import PropTypes from 'prop-types';
import Dialog from '@mui/material/Dialog';
import DialogTitle from '@mui/material/DialogTitle';
import DialogContent from '@mui/material/DialogContent';
import IconButton from '@mui/material/IconButton';
import Box from '@mui/material/Box';
import Typography from '@mui/material/Typography';
import LinearProgress from '@mui/material/LinearProgress';
import CloseRounded from '@mui/icons-material/CloseRounded';
import Logger from 'js-logger';
import FileUtil from '../util/FileUtil';
import { createLightReceiver } from './lightFrames';
import { framesNeeded } from './fountain.js';
import { readQrBytes, prepareReader } from './qrCodec';
import { notePairing } from './pairingLog';

export const LIGHT_RECEIVE_HELP = 'On the other phone: open a photo, then tap "Send by camera". Point this camera at the codes. Hold both phones still.';
export const CAMERA_ERROR = 'The camera is not available. Allow the camera for this page, then try again.';
const OUTCOME = {
    delivered: name => `${name} is here.`,
    already: name => `You have ${name} already.`,
    saved: name => `${name} is not in this room. It is saved on this phone.`,
    rejected: () => 'This is not the photo that the room has. It was not added.',
    unknown: () => 'This photo is from a different private room. It cannot be opened here.',
};
// A mixed code gives its blocks only near the end, all at once. So the
// part received is counted from the codes read.
export function receivedPart({ have, frames, blocks, done }) {
    if (done) return 1;
    return Math.min(0.99, Math.max(have / blocks, frames / framesNeeded(blocks)));
}

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

    useEffect(() => {
        if (!open) return undefined;
        let stopped = false;
        let stream = null;
        let timer = null;
        const receiver = createLightReceiver();
        const canvas = document.createElement('canvas');
        const context = canvas.getContext('2d', { willReadFrequently: true });
        let send = null; // { startedAt, freshBytes, read }
        let finished = false;
        let retryAt = 0;
        setFailed(false);
        setProgress(null);
        setOutcome('');

        const finish = async (state) => {
            const result = receiver.result();
            const seconds = (Date.now() - send.startedAt) / 1000;
            if (!result) {
                setOutcome(OUTCOME.rejected());
                return;
            }
            let how;
            try {
                how = await master.acceptNearbyPhoto(result.details, result.file);
            } catch (err) {
                // The file is whole: the next code read tries to add it again.
                Logger.warn('Adding the photo from the camera failed: ' + (err?.message || err));
                if (!stopped) setOutcome(ADD_FAILED);
                retryAt = Date.now() + RETRY_MS;
                finished = false;
                return;
            }
            if (stopped) return;
            setOutcome(OUTCOME[how](result.details.name || 'The photo'));
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
                        }
                        if (state.fresh) send.read++;
                        if (!finished && !retryAt) {
                            const seconds = Math.max((Date.now() - send.startedAt) / 1000, 0.5);
                            const part = receivedPart(state);
                            setProgress({ part, codes: state.frames, total: state.total, rate: part * state.total / seconds });
                        }
                        if (state.done && !finished && Date.now() >= retryAt) {
                            finished = true;
                            await finish(state);
                        }
                    }
                } catch (err) {
                    Logger.warn('Reading a code failed: ' + (err?.message || err));
                }
            }
            // As fast as the reader goes, with a pause for the page.
            timer = setTimeout(read, 4);
        };

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
            stream?.getTracks().forEach(track => track.stop());
        };
    }, [open, master]);

    const percent = progress ? Math.floor(progress.part * 100) : 0;

    return (
        <Dialog open={open} onClose={onClose} fullScreen aria-labelledby="light-receive-title">
            <DialogTitle id="light-receive-title" sx={{ textAlign: 'center', px: 6 }}>Get a photo by camera</DialogTitle>
            <IconButton aria-label="Close" onClick={onClose} sx={{ position: 'absolute', right: 8, top: 8 }}>
                <CloseRounded />
            </IconButton>
            <DialogContent sx={{ display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 1.5 }}>
                {failed ? (
                    <Typography role="alert" sx={{ py: 4, textAlign: 'center' }}>{CAMERA_ERROR}</Typography>
                ) : (
                    <>
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
                        <Typography variant="body2" sx={{ color: 'text.secondary', textAlign: 'center', maxWidth: 420 }}>
                            {outcome && outcome !== ADD_FAILED ? 'Point the camera at the next photo, or close this.' : LIGHT_RECEIVE_HELP}
                        </Typography>
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
