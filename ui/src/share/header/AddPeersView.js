import React, { useState, useEffect, useCallback, useRef } from 'react';
import PropTypes from 'prop-types';

import CloseRounded from '@mui/icons-material/CloseRounded';
import IconButton from '@mui/material/IconButton';
import PersonAddAlt1Rounded from '@mui/icons-material/PersonAddAlt1Rounded';
import ButtonBase from '@mui/material/ButtonBase';
import Dialog from '@mui/material/Dialog';
import DialogTitle from '@mui/material/DialogTitle';
import DialogContent from '@mui/material/DialogContent';
import Box from '@mui/material/Box';
import Typography from "@mui/material/Typography";
import { Html5QrcodeScanner } from 'html5-qrcode';
import Logger from 'js-logger';
import useMediaQuery from '@mui/material/useMediaQuery';
import { useTheme } from '@mui/material/styles';
import Fade from '@mui/material/Fade';
import { headerButtonSx, headerLabelSx } from './headerButtonSx';
import InviteCode from '../InviteCode';
import { setKeyInAddress } from '../privateRoom';
import { keyFromHash } from '../security/roomKey';

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
 * camera to read someone else's code.
 */
function AddPeersView({ master, showButton = true, inRoom = false, roomName = '' }) {
    const theme = useTheme();
    const isMobile = useMediaQuery(theme.breakpoints.down('sm'));

    const [invite, setInvite] = useState(false);
    const [scan, setScan] = useState(false);
    const [numPeers, setNumPeers] = useState(0);
    const scannerRef = useRef(null);

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
            master.service.id = urlParams.get('room');
            master.service.hasRoom = true;
            // A private room's key, before the room's photos arrive.
            setKeyInAddress(key);
            Logger.info('handleScan id ' + master.service.id);
            await master.findExistingContent(master.service.joinRoom);
            master.service.changeUrl('room', master.service.id);
            master.emitter.emit('hideFrontView');
            master.emitter.emit('readyToUpload');

            setScan(false);
        }
    }, [master]);

    // Start the camera when the scan dialog opens, stop it when it closes.
    useEffect(() => {
        if (scan && !scannerRef.current) {
            // Small delay to ensure DOM element exists
            const timer = setTimeout(() => {
                try {
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
                }
            }, 100);

            return () => clearTimeout(timer);
        }

        if (!scan && scannerRef.current) {
            scannerRef.current.clear().catch(err => Logger.error('Failed to clear scanner:', err));
            scannerRef.current = null;
        }
    }, [scan, handleScan]);

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
