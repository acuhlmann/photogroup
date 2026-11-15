import { useEffect, useState } from 'react';
import Logger from 'js-logger';
import { readQrBytes, prepareReader } from './qrCodec';

// The camera picture is cut to a square this wide before it is read. A
// link code is small: this is enough, and a small picture reads faster.
const READ_SIDE = 720;
const PAUSE_MS = 60;

/**
 * Runs a camera (the back one, or with `facing: 'user'` the front one) in a <video> and gives each QR code that it sees.
 * @param {object} options
 * @param {{current: HTMLVideoElement|null}} options.videoRef
 * @param {boolean} options.active the camera runs only while this is true
 * @param {(bytes: Uint8Array) => void|Promise<void>} options.onBytes called for each picture with a code, also for the same code again
 * @returns {{failed: boolean, running: boolean}}
 */
export function useCodeCamera({ videoRef, active, onBytes, facing = 'environment' }) {
    const [failed, setFailed] = useState(false);
    const [running, setRunning] = useState(false);
    // A camera track that ends (another app took it, the phone slept) used
    // to leave this watching a dead picture for ever. Starting again is
    // cheap, so an ended track bumps this and the camera is opened anew.
    const [attempt, setAttempt] = useState(0);

    useEffect(() => {
        if (!active) return undefined;
        let stopped = false;
        let stream = null;
        let timer = null;
        const canvas = document.createElement('canvas');
        const context = canvas.getContext('2d', { willReadFrequently: true });
        setFailed(false);
        setRunning(false);

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
                    if (bytes && !stopped) await onBytes(bytes);
                } catch (err) {
                    Logger.warn('Reading a code failed: ' + (err?.message || err));
                }
            }
            timer = setTimeout(read, PAUSE_MS);
        };

        (async () => {
            try {
                const ready = prepareReader();
                stream = await navigator.mediaDevices.getUserMedia({
                    audio: false,
                    video: { facingMode: facing, width: { ideal: 1280 }, height: { ideal: 720 } },
                });
                await ready;
                if (stopped) {
                    stream.getTracks().forEach(track => track.stop());
                    return;
                }
                const video = videoRef.current;
                video.srcObject = stream;
                stream.getVideoTracks().forEach(track => track.addEventListener('ended', () => {
                    if (!stopped) setAttempt(before => before + 1);
                }));
                await video.play().catch(() => {});
                setRunning(true);
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
            setRunning(false);
        };
        // onBytes is read through a ref by the caller; the camera does not restart for it.
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [active, videoRef, facing, attempt]);

    return { failed, running };
}
