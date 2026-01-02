import React, { useState, useEffect, useCallback } from 'react';
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
import EqualizerRounded from '@mui/icons-material/EqualizerRounded';
import AudiotrackRounded from '@mui/icons-material/AudiotrackRounded';
import copy from "clipboard-copy";
// QrReader import removed - react-qr-reader is not compatible with React 19
// import QrReader from 'react-qr-reader'
import Logger from 'js-logger';
import Uploader from "./Uploader";
//import Slide from '@mui/material/Slide';
import Fade from '@mui/material/Fade';

const Transition = React.forwardRef(function Transition(props, ref) {
    //return <Slide direction="down" ref={ref} {...props} />;
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
    }
});

function AddPeersView(props) {
    const {classes, master} = props;

    const [visible, setVisible] = useState(false);
    const [open, setOpen] = useState(false);
    const [createdRoom, setCreatedRoom] = useState(false);
    const [openQr, setOpenQr] = useState(false);
    const [scannerDelay] = useState(100);
    const [scannerResult, setScannerResult] = useState('No result');
    const [openRecorder, setOpenRecorder] = useState(false);
    const [audioType, setAudioType] = useState('secondary');
    const [numPeers, setNumPeers] = useState(0);
    const [copiedLink, setCopiedLink] = useState(false);

    const getFullUrl = useCallback((id) => {
        return window.location.origin + '?room=' + id;
    }, []);

    const show = useCallback((open) => {
        setOpen(open);
        setOpenQr(prev => !open ? false : prev);
        setVisible(open);
    }, []);

    const handleScanOrSound = useCallback(async (data, handledSound) => {
        if(!data) return;

        Logger.info('handleScanOrSound data ' + data, handledSound);

        let urlParams;
        try {
            const url = new URL(data);
            urlParams = new URLSearchParams(url.search);
        } catch(e) {
            Logger.error('handleScanOrSound error ' + e.message);
            return;
        }

        if(urlParams.has('room')) {
            setScannerResult(data);

            master.service.id = urlParams.get('room');
            master.service.hasRoom = true;
            Logger.info('handleScanOrSound id ' + master.service.id);
            await master.findExistingContent(master.service.joinRoom);
            master.service.changeUrl('room', master.service.id);
            master.emitter.emit('hideFrontView');
            master.emitter.emit('readyToUpload');

            show(false);
        }
    }, [master, show]);

    const listenOrPlaySound = useCallback((play = false, text = '', profileName = 'audible') => {
        const Quiet = window.Quiet;
        Quiet.init({
            profilesPrefix: "",
            memoryInitializerPrefix: "",
            libfecPrefix: ""
        });

        let transmit;
        function onQuietReady() {
            if(!play) {
                receive(profileName);
            } else {
                transmit = Quiet.transmitter({profile: profileName, onFinish: onTransmitFinish});
                Logger.info("send via voice: " + text);
                transmit.transmit(Quiet.str2ab(text));
            }
        }

        function onQuietFail(reason) {
            Logger.error("quiet failed to initialize: " + reason);
        }

        function onTransmitFinish() {
            Logger.info('onTransmitFinish');
        }

        function receive(profileName) {
            Quiet.receiver({profile: profileName,
                onReceive: onReceive,
                onCreateFail: onReceiverCreateFail,
                onReceiveFail: onReceiveFail
            });
        }
        let content = new ArrayBuffer(0);
        function onReceive(recvPayload) {
            Logger.info('mergeab ' + Quiet.mergeab(content, recvPayload));
            content = recvPayload;
            const result = Quiet.ab2str(content);
            Logger.info('onReceive ' + result);
            const parsed = result.split('m=')[1];
            Logger.info('onReceive parsed ' + parsed);
            if(parsed) {
                const url = getFullUrl(parsed);
                handleScanOrSound(url, true);
            }
        }

        function onReceiverCreateFail(reason) {
            Logger.error("failed to create quiet receiver: " + reason);
        }

        function onReceiveFail(num_fails) {
            Logger.error("onReceiveFail. closer to the receiver and set the volume to 50%." + num_fails);
        }

        Quiet.addReadyCallback(onQuietReady, onQuietFail);
    }, [getFullUrl, handleScanOrSound]);

    useEffect(() => {
        const emitter = master.emitter;

        const handleOpenRoomStart = () => {
            setVisible(true);
            setOpenRecorder(false);
        };

        const handleOpenRoomEnd = () => {
            setOpen(true);
            setCreatedRoom(true);
            setOpenRecorder(false);
        };

        const handleOpenQr = () => {
            setVisible(true);
            setOpen(true);
            setOpenQr(true);
            setOpenRecorder(false);
        };

        const handleOpenRecorder = () => {
            listenOrPlaySound(false, null, 'audible');
            setVisible(true);
            setOpen(true);
            setOpenRecorder(true);
            setAudioType('secondary');
        };

        const handleOpenRecorderUltrasonic = () => {
            listenOrPlaySound(false, null, 'ultrasonic');
            setVisible(true);
            setOpen(true);
            setOpenRecorder(true);
            setAudioType('inherit');
        };

        const handleOpenRecorderChirp = () => {
            Logger.warn('ChirpSDK feature has been removed');
            setVisible(true);
            setOpen(true);
            setOpenRecorder(false);
            setAudioType('primary');
        };

        const handleNumPeersChange = (numPeers) => {
            setNumPeers(numPeers);
        };

        emitter.on('openRoomStart', handleOpenRoomStart);
        emitter.on('openRoomEnd', handleOpenRoomEnd);
        emitter.on('openQr', handleOpenQr);
        emitter.on('openRecorder', handleOpenRecorder);
        emitter.on('openRecorderUltrasonic', handleOpenRecorderUltrasonic);
        emitter.on('openRecorderChirp', handleOpenRecorderChirp);
        emitter.on('numPeersChange', handleNumPeersChange);

        return () => {
            emitter.removeListener('openRoomStart', handleOpenRoomStart);
            emitter.removeListener('openRoomEnd', handleOpenRoomEnd);
            emitter.removeListener('openQr', handleOpenQr);
            emitter.removeListener('openRecorder', handleOpenRecorder);
            emitter.removeListener('openRecorderUltrasonic', handleOpenRecorderUltrasonic);
            emitter.removeListener('openRecorderChirp', handleOpenRecorderChirp);
            emitter.removeListener('numPeersChange', handleNumPeersChange);
        };
    }, [master.emitter, listenOrPlaySound]);

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
                                <span className={classes.horizontal}>
                                    <Typography variant={"body2"}>Play Audio Signal to Listening Peers</Typography>
                                    <IconButton color="secondary"
                                                onClick={() => listenOrPlaySound(true, url, 'audible') }>
                                        <AudiotrackRounded />
                                    </IconButton>
                                     <IconButton color="inherit"
                                                 onClick={() => listenOrPlaySound(true, url, 'ultrasonic') }>
                                        <AudiotrackRounded />
                                    </IconButton>
                                </span>
                            </span>
                            </span> : <span></span>
                        }
                    {
                        !openQr ?
                                '' :
                            <div>
                                {/* QrReader removed - react-qr-reader is not compatible with React 19 */}
                                <Typography variant={"body2"}>QR Scanner temporarily unavailable</Typography>
                                <Typography variant={"caption"}>{scannerResult}</Typography>
                            </div>
                    }
                    {
                        !openRecorder ?
                            '' :
                            <div>
                                <EqualizerRounded color={audioType}/>
                            </div>
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