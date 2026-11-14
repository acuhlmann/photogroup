import React, { useState, useEffect, useCallback, useRef } from 'react';
import PropTypes from 'prop-types';

import CloseRounded from '@mui/icons-material/CloseRounded';
import CropFreeRounded from '@mui/icons-material/CropFreeRounded';
import HearingRounded from '@mui/icons-material/HearingRounded';
import IconButton from '@mui/material/IconButton';
import PersonAddAlt1Rounded from '@mui/icons-material/PersonAddAlt1Rounded';
import ButtonBase from '@mui/material/ButtonBase';
import Dialog from '@mui/material/Dialog';
import DialogTitle from '@mui/material/DialogTitle';
import DialogContent from '@mui/material/DialogContent';
import Box from '@mui/material/Box';
import Button from '@mui/material/Button';
import Typography from "@mui/material/Typography";
import Logger from 'js-logger';
import useMediaQuery from '@mui/material/useMediaQuery';
import { useTheme } from '@mui/material/styles';
import Fade from '@mui/material/Fade';
import { headerButtonSx, headerLabelSx } from './headerButtonSx';
import InviteCode from '../InviteCode';
import { keyFromHash } from '../security/roomKey';
import { joinRoomByCode } from '../openRoom';
import SoundListen from '../nearby/SoundListen';
import { canListen } from '../nearby/soundModem';
import { notePairing } from '../nearby/pairingLog';

const Transition = React.forwardRef(function Transition(props, ref) {
    return <Fade ref={ref} {...props} />;
});

function DialogClose({ onClose }) {
    return (
        <IconButton aria-label="Close" onClick={onClose} sx={{ position: 'absolute', right: 8, top: 8 }}>
            <CloseRounded />
        </IconButton>
    );
}

DialogClose.propTypes = { onClose: PropTypes.func.isRequired };

/**
 * Two dialogs about people and rooms. In a room, the header's Invite button
 * opens the code to scan and the link to send (simple mode shows the same
 * code in the page instead). On the front page, "Scan to join" opens the
 * camera to read someone else's code, or the microphone to hear it.
 */
function AddPeersView({ master, showButton = true, inRoom = false, roomName = '' }) {
    const theme = useTheme();
    const isMobile = useMediaQuery(theme.breakpoints.down('sm'));

    const [invite, setInvite] = useState(false);
    const [scan, setScan] = useState(false);
    // The scanner code loads on first use; on a bad connection that can fail.
    const [scanFailed, setScanFailed] = useState(false);
    // One at a time: iPhones give a page the camera or the microphone, not both.
    const [listening, setListening] = useState(false);
    const cameraOn = scan && !listening;
    const [numPeers, setNumPeers] = useState(0);
    const scannerRef = useRef(null);
    // The scanner empties its element when its camera has stopped; a new one waits for that.
    const clearingRef = useRef(null);

    const handleScan = useCallback(async (data) => {
        if(!data) return;

        Logger.info('handleScan data ' + data);

        let urlParams, key;
        try {
            const url = new URL(data);
            urlParams = new URLSearchParams(url.search);
            key = keyFromHash(url.hash);
        } catch(e) {
            Logger.error('handleScan error ' + e.message);
            return;
        }

        if(urlParams.has('room')) {
            notePairing(master.emitter, { channel: 'qr', direction: 'in', bytes: data.length });
            await joinRoomByCode(master, { room: urlParams.get('room'), key });
            Logger.info('handleScan id ' + master.service.id);
            setScan(false);
        }
    }, [master]);

    const handleHeard = useCallback(async (code, { bytes, ms }) => {
        Logger.info('Room code heard: ' + code.room);
        notePairing(master.emitter, { channel: 'sound', direction: 'in', bytes, ms });
        try {
            await joinRoomByCode(master, code);
        } catch (err) {
            Logger.error('Joining the heard room failed: ' + (err?.message || err));
            master.emitter.emit('showError', "Couldn't join the room. Try again.");
        }
        setScan(false);
    }, [master]);

    // Start the camera when the scan dialog opens, stop it when it closes.
    useEffect(() => {
        if (cameraOn && !scannerRef.current) {
            let cancelled = false;
            // Small delay to ensure DOM element exists. The scanner code is
            // large and only loaded when someone scans.
            const timer = setTimeout(async () => {
                try {
                    await clearingRef.current;
                    const { Html5QrcodeScanner } = await import('html5-qrcode');
                    if (cancelled || scannerRef.current) return;
                    const scanner = new Html5QrcodeScanner(
                        "qr-reader",
                        {
                            fps: 10,
                            qrbox: { width: 250, height: 250 },
                            rememberLastUsedCamera: true,
                            aspectRatio: 1.0
                        },
                        /* verbose= */ false
                    );

                    scanner.render(
                        (decodedText) => {
                            Logger.info('QR Code scanned: ' + decodedText);
                            handleScan(decodedText);
                            scanner.clear().catch(err => Logger.error('Failed to clear scanner:', err));
                            scannerRef.current = null;
                        },
                        () => {
                            // Ignore scan failures - they happen constantly while scanning
                        }
                    );

                    scannerRef.current = scanner;
                } catch (err) {
                    Logger.error('Failed to initialize QR scanner:', err);
                    if (!cancelled) setScanFailed(true);
                }
            }, 100);

            return () => {
                cancelled = true;
                clearTimeout(timer);
            };
        }

        if (!cameraOn && scannerRef.current) {
            clearingRef.current = scannerRef.current.clear().catch(err => Logger.error('Failed to clear scanner:', err));
            scannerRef.current = null;
        }
        if (!scan) {
            setScanFailed(false);
            setListening(false);
        }
    }, [scan, cameraOn, handleScan]);

    // Cleanup scanner on unmount
    useEffect(() => {
        return () => {
            if (scannerRef.current) {
                scannerRef.current.clear().catch(err => Logger.error('Failed to clear scanner on unmount:', err));
                scannerRef.current = null;
            }
        };
    }, []);

    useEffect(() => {
        const emitter = master.emitter;
        const handleOpenQr = () => setScan(true);
        const handleOpenShare = () => setInvite(true);
        const handleNumPeersChange = (count) => setNumPeers(count);

        emitter.on('openQr', handleOpenQr);
        emitter.on('openShare', handleOpenShare);
        emitter.on('numPeersChange', handleNumPeersChange);

        return () => {
            emitter.removeListener('openQr', handleOpenQr);
            emitter.removeListener('openShare', handleOpenShare);
            emitter.removeListener('numPeersChange', handleNumPeersChange);
        };
    }, [master.emitter]);

    return (
        <div>
            {showButton && inRoom && <ButtonBase
                aria-label={`Invite people (${numPeers || 1} in the room)`}
                onClick={() => setInvite(true)}
                sx={headerButtonSx}>
                <PersonAddAlt1Rounded />
                <Box component="span" sx={{ ...headerLabelSx, display: { xs: 'none', sm: 'inline' } }}>
                    Invite
                </Box>
                {numPeers > 0 && (
                    <Box component="span" sx={{
                        ...headerLabelSx,
                        minWidth: 18,
                        px: 0.6,
                        py: 0.35,
                        borderRadius: '4px',
                        color: 'primary.main',
                        backgroundColor: 'var(--accent-soft)',
                        fontVariantNumeric: 'tabular-nums',
                    }}>
                        {numPeers}
                    </Box>
                )}
            </ButtonBase>}

            <Dialog
                open={invite && inRoom}
                onClose={() => setInvite(false)}
                slots={{ transition: Transition }}
                maxWidth="xs"
                fullWidth
                aria-labelledby="invite-title"
            >
                <DialogTitle id="invite-title" sx={{ textAlign: 'center', pr: 6, pl: 6 }}>
                    Invite people{roomName ? ` to ${roomName}` : ''}
                </DialogTitle>
                <DialogClose onClose={() => setInvite(false)} />
                <DialogContent sx={{ pb: 3 }}>
                    <InviteCode master={master} roomName={roomName} size={200} />
                </DialogContent>
            </Dialog>

            <Dialog
                open={scan}
                onClose={() => setScan(false)}
                slots={{ transition: Transition }}
                fullScreen={isMobile}
                maxWidth="sm"
                fullWidth
                aria-labelledby="scan-title"
            >
                <DialogTitle id="scan-title" sx={{ textAlign: 'center', pr: 6, pl: 6 }}>Scan to join</DialogTitle>
                <DialogClose onClose={() => setScan(false)} />
                <DialogContent>
                    {listening && <SoundListen onCode={handleHeard} />}
                    {/* Hidden, not removed: the scanner must find its element to stop the camera. */}
                    <Box sx={{ display: listening ? 'none' : 'block' }}>
                        <Typography variant="body2" sx={{ color: 'text.secondary', textAlign: 'center', mb: 1.5 }}>
                            Point the camera at the code on the other phone.
                        </Typography>
                        <Box
                            sx={{
                                width: '100%',
                                maxWidth: 400,
                                mx: 'auto',
                                borderRadius: 2,
                                overflow: 'hidden',
                                border: '1px solid',
                                borderColor: 'divider',
                                '& #qr-reader': {
                                    border: 'none !important',
                                },
                                '& #qr-reader__scan_region': {
                                    minHeight: 250,
                                },
                            }}
                        >
                            <div id="qr-reader"></div>
                        </Box>
                    </Box>
                    {canListen() && (
                        <Box sx={{ textAlign: 'center', mt: 1.5 }}>
                            <Button
                                startIcon={listening ? <CropFreeRounded /> : <HearingRounded />}
                                onClick={() => setListening(value => !value)}
                                sx={{ textTransform: 'none' }}
                            >
                                {listening ? 'Use the camera instead' : 'Listen for the sound instead'}
                            </Button>
                        </Box>
                    )}
                    {scanFailed && !listening && (
                        <Box sx={{ textAlign: 'center', mt: 2 }}>
                            <Typography variant="body2" sx={{ mb: 1 }}>
                                Cannot start the scanner. Check your connection.
                            </Typography>
                            {/* The browser keeps a failed import for the page's life. */}
                            <Button variant="outlined" onClick={() => window.location.reload()}>Reload the page</Button>
                        </Box>
                    )}
                </DialogContent>
            </Dialog>
        </div>
    );
}

AddPeersView.propTypes = {
    master: PropTypes.object.isRequired,
    showButton: PropTypes.bool,
    inRoom: PropTypes.bool,
    roomName: PropTypes.string,
};

export default AddPeersView;
