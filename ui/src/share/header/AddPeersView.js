import React, { useState, useEffect, useCallback, useRef } from 'react';
import PropTypes from 'prop-types';

import CloseRounded from '@mui/icons-material/CloseRounded';
import ExitToAppOutlined from '@mui/icons-material/ExitToAppOutlined';
import IconButton from '@mui/material/IconButton';
import IosShareRounded from '@mui/icons-material/IosShareRounded';
import Badge from '@mui/material/Badge';
import Dialog from '@mui/material/Dialog';
import DialogContent from '@mui/material/DialogContent';
import DialogActions from '@mui/material/DialogActions';
import Button from '@mui/material/Button';
import Box from '@mui/material/Box';
import Stack from '@mui/material/Stack';
import { QRCodeSVG } from "qrcode.react";
import Typography from "@mui/material/Typography";
import ShareRounded from '@mui/icons-material/ShareRounded';
import ContentCopyRounded from '@mui/icons-material/ContentCopyRounded';
import copy from "clipboard-copy";
import { Html5QrcodeScanner } from 'html5-qrcode';
import Logger from 'js-logger';
import useMediaQuery from '@mui/material/useMediaQuery';
import { useTheme } from '@mui/material/styles';
import Fade from '@mui/material/Fade';

const Transition = React.forwardRef(function Transition(props, ref) {
    return <Fade ref={ref} {...props} />;
});

function AddPeersView({ master }) {
    const theme = useTheme();
    const isMobile = useMediaQuery(theme.breakpoints.down('sm'));

    const [visible, setVisible] = useState(false);
    const [open, setOpen] = useState(false);
    const [createdRoom, setCreatedRoom] = useState(false);
    const [openQr, setOpenQr] = useState(false);
    const [scannerResult, setScannerResult] = useState('');
    const [numPeers, setNumPeers] = useState(0);
    const [copiedLink, setCopiedLink] = useState(false);
    const scannerRef = useRef(null);

    const getFullUrl = useCallback((id) => {
        return window.location.origin + '?room=' + id;
    }, []);

    const show = useCallback((open) => {
        setOpen(open);
        setOpenQr(prev => !open ? false : prev);
        setVisible(open);
    }, []);

    const handleScan = useCallback(async (data) => {
        if(!data) return;

        Logger.info('handleScan data ' + data);

        let urlParams;
        try {
            const url = new URL(data);
            urlParams = new URLSearchParams(url.search);
        } catch(e) {
            Logger.error('handleScan error ' + e.message);
            return;
        }

        if(urlParams.has('room')) {
            setScannerResult(data);

            master.service.id = urlParams.get('room');
            master.service.hasRoom = true;
            Logger.info('handleScan id ' + master.service.id);
            await master.findExistingContent(master.service.joinRoom);
            master.service.changeUrl('room', master.service.id);
            master.emitter.emit('hideFrontView');
            master.emitter.emit('readyToUpload');

            show(false);
        }
    }, [master, show]);

    // Initialize QR scanner when openQr changes
    useEffect(() => {
        if (openQr && !scannerRef.current) {
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
                        (errorMessage) => {
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

        // Cleanup when openQr becomes false
        if (!openQr && scannerRef.current) {
            scannerRef.current.clear().catch(err => Logger.error('Failed to clear scanner:', err));
            scannerRef.current = null;
        }
    }, [openQr, handleScan]);

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

        const handleOpenRoomStart = () => {
            setVisible(true);
        };

        const handleOpenRoomEnd = () => {
            setCreatedRoom(true);
        };

        const handleOpenQr = () => {
            setVisible(true);
            setOpen(true);
            setOpenQr(true);
        };

        const handleNumPeersChange = (numPeers) => {
            setNumPeers(numPeers);
        };

        emitter.on('openRoomStart', handleOpenRoomStart);
        emitter.on('openRoomEnd', handleOpenRoomEnd);
        emitter.on('openQr', handleOpenQr);
        emitter.on('numPeersChange', handleNumPeersChange);

        return () => {
            emitter.removeListener('openRoomStart', handleOpenRoomStart);
            emitter.removeListener('openRoomEnd', handleOpenRoomEnd);
            emitter.removeListener('openQr', handleOpenQr);
            emitter.removeListener('numPeersChange', handleNumPeersChange);
        };
    }, [master.emitter]);

    const copyLink = useCallback(async (url) => {
        try {
            await copy(url);
            Logger.info('copy ' + url);
            setCopiedLink(true);
            setTimeout(() => {
                setCopiedLink(false);
            }, 4000);
        } catch(e) {
            Logger.error('Failure on copying link ' + e);
        }
    }, []);

    const shareLink = useCallback(async (shareData) => {
        try {
            await navigator.share(shareData)
        } catch(e) {
            Logger.error('navigator.share failed ' + e);
        }
    }, []);

    const hasRoom = useCallback(() => {
        const urlParams = new URLSearchParams(window.location.search);
        return urlParams.has('room');
    }, []);

    const url = getFullUrl(master.service.id);
    const hasRoomValue = hasRoom();

    const shareData = {
        title: 'PhotoGroup',
        text: 'Get this picture',
        url: url
    };
    const canShare = (navigator.canShare
        && navigator.share
        && typeof navigator.share === 'function') ? navigator.canShare(shareData) : false;

    return (
        visible || hasRoomValue ? <div>
            <IconButton
                onClick={() => show(true)}>
                <Badge badgeContent={numPeers} color="primary" >
                    <IosShareRounded />
                </Badge>
            </IconButton>

            <Dialog
                open={open}
                onClose={() => show(false)}
                TransitionComponent={Transition}
                keepMounted
                fullScreen={isMobile}
                maxWidth="sm"
                fullWidth
            >
                <DialogContent
                    sx={{
                        display: 'flex',
                        flexDirection: 'column',
                        alignItems: 'center',
                        textAlign: 'center',
                        gap: 3,
                        py: 3,
                    }}
                >
                    {/* Share Room Section */}
                    {(hasRoomValue || createdRoom) && (
                        <Stack spacing={2.5} alignItems="center" sx={{ width: '100%' }}>
                            <Typography variant="subtitle1" fontWeight={600}>
                                Share Room
                            </Typography>

                            {/* QR Code on dark background */}
                            <Box
                                sx={{
                                    bgcolor: '#111820',
                                    p: 2.5,
                                    borderRadius: 2,
                                    display: 'inline-flex',
                                }}
                            >
                                <QRCodeSVG
                                    value={url}
                                    bgColor="#111820"
                                    fgColor="#e4e8ee"
                                    size={180}
                                />
                            </Box>

                            {/* Room ID with copy */}
                            <Stack
                                direction="row"
                                alignItems="center"
                                spacing={1}
                                sx={{
                                    bgcolor: 'action.hover',
                                    borderRadius: 1,
                                    px: 2,
                                    py: 0.5,
                                }}
                            >
                                <Typography
                                    variant="caption"
                                    sx={{
                                        fontFamily: 'var(--font-mono)',
                                        fontSize: '0.75rem',
                                        color: 'text.secondary',
                                        wordBreak: 'break-all',
                                    }}
                                >
                                    {master.service.id}
                                </Typography>
                                <IconButton
                                    size="small"
                                    onClick={() => copyLink(url)}
                                    color="primary"
                                >
                                    <ContentCopyRounded fontSize="small" />
                                </IconButton>
                            </Stack>

                            {/* Share buttons row */}
                            <Stack direction="row" spacing={1.5} justifyContent="center">
                                {canShare && (
                                    <Button
                                        variant="outlined"
                                        size="small"
                                        startIcon={<ShareRounded />}
                                        onClick={() => shareLink(shareData)}
                                    >
                                        Share
                                    </Button>
                                )}
                            </Stack>

                            {/* Copied feedback */}
                            {copiedLink && (
                                <Typography
                                    variant="caption"
                                    sx={{ color: 'success.main', fontWeight: 600 }}
                                >
                                    Copied!
                                </Typography>
                            )}
                        </Stack>
                    )}

                    {/* QR Scanner Section */}
                    {openQr && (
                        <Box
                            sx={{
                                width: '100%',
                                maxWidth: 400,
                                mx: 'auto',
                                '& #qr-reader': {
                                    border: 'none !important',
                                },
                                '& #qr-reader__scan_region': {
                                    minHeight: 250,
                                },
                            }}
                        >
                            <Typography
                                variant="subtitle1"
                                fontWeight={600}
                                sx={{ mb: 1.5 }}
                            >
                                Scan to Join
                            </Typography>
                            <Box
                                sx={{
                                    borderRadius: 2,
                                    overflow: 'hidden',
                                    border: '1px solid',
                                    borderColor: 'divider',
                                }}
                            >
                                <div id="qr-reader"></div>
                            </Box>
                            {scannerResult && (
                                <Typography
                                    variant="caption"
                                    sx={{ mt: 1, color: 'success.main' }}
                                >
                                    Scanned: {scannerResult}
                                </Typography>
                            )}
                        </Box>
                    )}
                </DialogContent>

                <DialogActions
                    sx={{
                        display: 'flex',
                        alignItems: 'center',
                        justifyContent: 'space-between',
                        px: 2,
                        py: 1.5,
                        borderTop: '1px solid',
                        borderColor: 'divider',
                    }}
                >
                    {hasRoomValue ? (
                        <Button
                            variant="outlined"
                            color="error"
                            size="small"
                            startIcon={<ExitToAppOutlined />}
                            onClick={() => master.leaveRoomAndReload()}
                        >
                            Leave Room
                        </Button>
                    ) : (
                        <Box />
                    )}

                    <IconButton onClick={() => show(false)}>
                        <CloseRounded />
                    </IconButton>
                </DialogActions>
            </Dialog>
        </div> : <div></div>
    );
}

AddPeersView.propTypes = {
    master: PropTypes.object.isRequired,
};

export default AddPeersView;
