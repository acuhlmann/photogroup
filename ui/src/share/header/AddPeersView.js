import React, { useState, useEffect, useCallback, useRef } from 'react';
import PropTypes from 'prop-types';

import { withStyles } from '@mui/styles';
import CloseRounded from '@mui/icons-material/CloseRounded';
import ExitToAppOutlined from '@mui/icons-material/ExitToAppOutlined';
import IconButton from '@mui/material/IconButton';
import GroupAddRounded from '@mui/icons-material/GroupAddRounded';
import Badge from '@mui/material/Badge';
import Dialog from '@mui/material/Dialog';
import DialogContent from '@mui/material/DialogContent';
import DialogActions from '@mui/material/DialogActions';
import { QRCodeSVG } from "qrcode.react";
import {Typography} from "@mui/material";
import LinkRounded from '@mui/icons-material/LinkRounded';
import ShareRounded from '@mui/icons-material/ShareRounded';
import copy from "clipboard-copy";
import { Html5QrcodeScanner } from 'html5-qrcode';
import Logger from 'js-logger';
import Uploader from "./Uploader";
import Fade from '@mui/material/Fade';

const Transition = React.forwardRef(function Transition(props, ref) {
    return <Fade ref={ref} {...props} />;
});

const styles = theme => ({
    vertical: {
        display: 'flex',
        flexDirection: 'column',
        alignItems: 'center',
        justifyContent: 'center'
    },
    horizontal: {
        display: 'flex',
        flexDirection: 'row',
        alignItems: 'center',
        justifyContent: 'center'
    },
    qrReader: {
        width: '100%',
        maxWidth: '400px',
        margin: '0 auto',
        '& #qr-reader': {
            border: 'none !important'
        },
        '& #qr-reader__scan_region': {
            minHeight: '250px'
        }
    }
});

function AddPeersView(props) {
    const {classes, master} = props;

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
            setOpen(true);
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
                    <GroupAddRounded />
                </Badge>
            </IconButton>

            <Dialog
                open={open}
                onClose={() => show(false)}
                TransitionComponent={Transition}
                keepMounted
                maxWidth="md"
                fullWidth
            >
                <DialogContent className={classes.vertical} style={{
                    textAlign: 'center'
                }}>

                    {
                        hasRoomValue || createdRoom ? <span style={{
                            marginBottom: '20px'
                        }}>
                            <Typography variant="body1">Share this room via either...</Typography>
                            <span className={classes.vertical} style={{
                                marginTop: '10px'
                            }}>

                                <span className={classes.vertical}>
                                    <Typography variant={"caption"}>{master.service.id}</Typography>
                                    <QRCodeSVG value={url} />
                                </span>
                                <span className={classes.horizontal}>
                                    <Typography variant={"body2"}>Copy/Paste Link</Typography>
                                    <IconButton color="primary"
                                        onClick={() => copyLink(url)}>
                                        <LinkRounded />
                                    </IconButton>
                                    {copiedLink ? <Typography variant={"caption"}>Copied</Typography> : ''}
                                </span>
                                {canShare ? <span className={classes.horizontal}>
                                    <Typography variant={"body2"}>Share via App</Typography>
                                    <IconButton color="primary"
                                        onClick={() => shareLink(shareData)}>
                                        <ShareRounded />
                                    </IconButton>
                                </span> : ''}
                            </span>
                            </span> : <span></span>
                        }
                    {
                        openQr ? (
                            <div className={classes.qrReader}>
                                <Typography variant={"body2"} style={{ marginBottom: '10px' }}>
                                    Scan a QR code to join a room
                                </Typography>
                                <div id="qr-reader"></div>
                                {scannerResult && (
                                    <Typography variant={"caption"}>Scanned: {scannerResult}</Typography>
                                )}
                            </div>
                        ) : null
                    }
                </DialogContent>
                <DialogActions style={{
                    flex: '0 0 auto',
                    display: 'flex',
                    padding: '8px',
                    alignItems: 'center',
                    justifyContent: 'space-between',
                }}>

                    {hasRoomValue ? <span className={classes.horizontal}>
                                    <Typography variant={"body2"}>Leave Room</Typography>
                                    <IconButton
                                                onClick={() => master.leaveRoomAndReload() }>
                                        <ExitToAppOutlined />
                                    </IconButton>
                                </span> : ''}
                    <Uploader model={master.torrentAddition}
                              emitter={master.emitter} />
                    <IconButton
                                onClick={() => show(false)}
                    >
                        <CloseRounded />
                    </IconButton>

                </DialogActions>
            </Dialog>
        </div> : <div></div>
    );
}

AddPeersView.propTypes = {
    classes: PropTypes.object.isRequired,
    master: PropTypes.object.isRequired,
};

export default withStyles(styles)(AddPeersView);
