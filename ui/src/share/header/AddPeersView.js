import React, { Component } from 'react';
import PropTypes from 'prop-types';

import { withStyles } from '@material-ui/core/styles';
import CloseRounded from '@material-ui/icons/CloseRounded';
import ExitToAppOutlined from '@material-ui/icons/ExitToAppOutlined';
import IconButton from '@material-ui/core/IconButton';
import GroupAddRounded from '@material-ui/icons/GroupAddRounded';
import Badge from '@material-ui/core/Badge';
import Dialog from '@material-ui/core/Dialog';
import DialogContent from '@material-ui/core/DialogContent';
import DialogActions from '@material-ui/core/DialogActions';
import QRCode from "qrcode.react";
import {Typography} from "@material-ui/core";
import LinkRounded from '@material-ui/icons/LinkRounded';
import ShareRounded from '@material-ui/icons/ShareRounded';
import EqualizerRounded from '@material-ui/icons/EqualizerRounded';
import AudiotrackRounded from '@material-ui/icons/AudiotrackRounded';
import copy from "clipboard-copy";
import QrReader from 'react-qr-reader'
import Logger from 'js-logger';
import ChirpSDK from 'chirp-js-sdk';
import Uploader from "./Uploader";
//import Slide from '@material-ui/core/Slide';
import Fade from '@material-ui/core/Fade';

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

class AddPeersView extends Component {

    constructor(props) {
        super(props);

        this.state = {
            visible: false,
            open: false,
            createdRoom: false,
            openQr: false,
            scannerDelay: 100,
            scannerResult: 'No result'
        };

        props.master.emitter.on('openRoomStart', () => {
            this.setState({
                visible: true,
                openRecorder: false,
            });
        });

        props.master.emitter.on('openRoomEnd', () => {
            this.setState({
                open: true,
                createdRoom: true,
                openRecorder: false,
            });
        });

        props.master.emitter.on('openQr', () => {
            this.setState({
                visible: true,
                open: true,
                openQr: true,
                openRecorder: false
            });
        });

        props.master.emitter.on('openRecorder', () => {
            this.listenOrPlaySound(false, null, 'audible');
            this.setState({
                visible: true,
                open: true,
                openRecorder: true,
                audioType: 'secondary'
            });
        });

        props.master.emitter.on('openRecorderUltrasonic', () => {
            this.listenOrPlaySound(false, null, 'ultrasonic');
            this.setState({
                visible: true,
                open: true,
                openRecorder: true,
                audioType: 'inherit'
            });
        });

        props.master.emitter.on('openRecorderChirp', () => {
            this.listenAudioChirp();
            this.setState({
                visible: true,
                open: true,
                openRecorder: true,
                audioType: 'primary'
            });
        });

        props.master.emitter.on('numPeersChange', numPeers => {
            this.setState({
                numPeers: numPeers,
            });
        });

        this.handleScanOrSound = this.handleScanOrSound.bind(this)
    }

    listenAudioChirp() {

        const { Chirp, toAscii, CHIRP_SDK_STATE } = window.ChirpSDK;

        const self = this;
        Chirp({
            key: '62c52CE2027c8eac9A4D6Add1',
            onStateChanged: (previous, current) => {
                if (current === CHIRP_SDK_STATE.STOPPED) {
                    Logger.info('ChirpSDK has stopped')
                }
            },
            onSending: data => {
                Logger.info('Sending data...')
            },
            onSent: data => {
                Logger.info('Sent data')
            },
            onReceiving: () => {
                Logger.info('Receiving data...')
            },
            onReceived: data => {
                if (data.length > 0) {
                    const result = toAscii(data);
                    Logger.info(result);
                    const url = self.getFullUrl(result);
                    self.handleScanOrSound(url, true);
                } else {
                    Logger.error('Decode failed');
                }
            }
        }).then(sdk => sdk.start()).catch(Logger.error);
    }

    sendAudioChirp(id) {
        //const { Chirp } = window.ChirpSDK;

        const chirp = new ChirpSDK('62c52CE2027c8eac9A4D6Add1');
        const payload = new TextEncoder('utf-8').encode(id);
        chirp.send(payload).then(() => {
            Logger.info('sent ' + payload);
        }).catch(Logger.error);
        /*Chirp({ key: '62c52CE2027c8eac9A4D6Add1' })
            .then(sdk => { sdk.start()
                .then(() => {
                const rc = sdk.send(id);
                if (rc !== 0) Logger.error(sdk.errorToString(rc))
            }).catch(Logger.error)
        }).catch(Logger.error);*/
    }

    listenOrPlaySound(play = false, text = '', profileName = 'audible') {

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

        //-----------receive

        function receive(profileName) {
            Quiet.receiver({profile: profileName,
                onReceive: onReceive,
                onCreateFail: onReceiverCreateFail,
                onReceiveFail: onReceiveFail
            });
        }
        let content = new ArrayBuffer(0);
        const self = this;
        function onReceive(recvPayload) {
            Logger.info('mergeab ' + Quiet.mergeab(content, recvPayload));
            content = recvPayload;
            const result = Quiet.ab2str(content);
            Logger.info('onReceive ' + result);
            const parsed = result.split('m=')[1];
            Logger.info('onReceive parsed ' + parsed);
            if(parsed) {
                const url = self.getFullUrl(parsed);
                self.handleScanOrSound(url, true);
            }
        }

        function onReceiverCreateFail(reason) {
            Logger.error("failed to create quiet receiver: " + reason);
        }

        function onReceiveFail(num_fails) {
            Logger.error("onReceiveFail. closer to the receiver and set the volume to 50%." + num_fails);
        }

        Quiet.addReadyCallback(onQuietReady, onQuietFail);
    }

    async handleScanOrSound(data, handledSound){

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

            this.setState({
                scannerResult: data,
            });

            const master = this.props.master;
            master.service.id = urlParams.get('room');
            master.service.hasRoom = true;
            //master.emitter.emit('openRoomStart');
            Logger.info('handleScanOrSound id ' + master.service.id);
            await master.findExistingContent(master.service.joinRoom);
            master.service.changeUrl('room', master.service.id);
            //master.emitter.emit('openRoomEnd');
            master.emitter.emit('hideFrontView');

            master.emitter.emit('readyToUpload');

            this.show(false);
        }
    }

    handleScanError(err){
        console.error(err)
    }

    async show(open) {

        this.setState({
            open: open,
            openQr: !open ? false : this.state.openQr,
            visible: open
        });

        /*try {
            const stream = await navigator.mediaDevices.getUserMedia({ audio: true, video: true });
            const tracks = stream.getAudioTracks();
            Logger.info('stream ' + stream);
            tracks.forEach(item => item.stop());
        } catch(err) {
            Logger.error('cannot get media stream to cancel permissions ' + err);
        }*/
    }

    async copyLink(url) {

        try {
            await copy(url);
            Logger.info('copy ' + url);
            this.setState({copiedLink: true});
            setTimeout(() => {
                this.setState({copiedLink: false});
            }, 4000);
        } catch(e) {
            Logger.error('Failure on copying link ' + e);
        }
    }

    async shareLink(shareData) {

        try {
            await navigator.share(shareData)
        } catch(e) {
            Logger.error('navigator.share failed ' + e);
        }
    }

    hasRoom() {
        const urlParams = new URLSearchParams(window.location.search);
        return urlParams.has('room');
    }

    leaveRoom() {
        const location = window.location;
        window.history.replaceState({}, '', decodeURIComponent(`${location.pathname}`));
        location.reload();
    }

    getFullUrl(id) {
        return window.location.origin + '?room=' + id;
    }

    render() {
        const {classes, master} = this.props;
        const {visible, createdRoom, openQr, openRecorder, audioType, numPeers, open, copiedLink} = this.state;
        const url = this.getFullUrl(master.service.id);
        const hasRoom = this.hasRoom();

        const scannerStyle = {
            height: 280,
            width: 300,
        };

        const shareData = {
            title: 'PhotoGroup',
            text: 'Get this picture',
            url: url
        };
        const canShare = (navigator.canShare
            && navigator.share
            && typeof navigator.share === 'function') ? navigator.canShare(shareData) : false;

        return (
            visible || hasRoom ? <div>
                <IconButton
                    onClick={this.show.bind(this, true)}>
                    <Badge badgeContent={numPeers} color="primary" >
                        <GroupAddRounded />
                    </Badge>
                </IconButton>

                <Dialog
                    open={open}
                    onClose={this.show.bind(this, false)}
                    TransitionComponent={Transition}
                    keepMounted
                >
                    <DialogContent className={classes.vertical} style={{
                        textAlign: 'center'
                    }}>

                        {
                            hasRoom || createdRoom ? <span style={{
                                marginBottom: '20px'
                            }}>
                                <Typography variant="body1">Share this room via either...</Typography>
                                <span className={classes.vertical} style={{
                                    marginTop: '10px'
                                }}>

                                    <span className={classes.vertical}>
                                        <Typography variant={"caption"}>{master.service.id}</Typography>
                                        <QRCode value={url} />
                                    </span>
                                    <span className={classes.horizontal}>
                                        <Typography variant={"body2"}>Copy/Paste Link</Typography>
                                        <IconButton color="primary"
                                            onClick={() => this.copyLink(url)}>
                                            <LinkRounded />
                                        </IconButton>
                                        {copiedLink ? <Typography variant={"caption"}>Copied</Typography> : ''}
                                    </span>
                                    {canShare ? <span className={classes.horizontal}>
                                        <Typography variant={"body2"}>Share via App</Typography>
                                        <IconButton color="primary"
                                            onClick={() => this.shareLink(shareData)}>
                                            <ShareRounded />
                                        </IconButton>
                                    </span> : ''}
                                    <span className={classes.horizontal}>
                                        <Typography variant={"body2"}>Play Audio Signal to Listening Peers</Typography>
                                        <IconButton color="primary"
                                            onClick={() => this.sendAudioChirp(master.service.id) }>
                                            <AudiotrackRounded />
                                        </IconButton>
                                        <IconButton color="secondary"
                                                    onClick={() => this.listenOrPlaySound(true, url, 'audible') }>
                                            <AudiotrackRounded />
                                        </IconButton>
                                         <IconButton color="inherit"
                                                     onClick={() => this.listenOrPlaySound(true, url, 'ultrasonic') }>
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
                                    <QrReader
                                        delay={this.state.scannerDelay}
                                        facingMode={"environment"}
                                        showViewFinder={true}
                                        style={scannerStyle}
                                        onError={this.handleScanError}
                                        onScan={this.handleScanOrSound}/>
                                    <Typography variant={"caption"}>{this.state.scannerResult}</Typography>
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

                        {hasRoom ? <span className={classes.horizontal}>
                                        <Typography variant={"body2"}>Leave Room</Typography>
                                        <IconButton
                                                    onClick={() => this.leaveRoom() }>
                                            <ExitToAppOutlined />
                                        </IconButton>
                                    </span> : ''}
                        <Uploader model={master.torrentAddition}
                                  emitter={master.emitter} />
                        <IconButton
                                    onClick={this.show.bind(this, false)}
                        >
                            <CloseRounded />
                        </IconButton>

                    </DialogActions>
                </Dialog>
            </div> : <div></div>
        );
    }
}

AddPeersView.propTypes = {
    classes: PropTypes.object.isRequired,
    master: PropTypes.object.isRequired,
};

export default withStyles(styles)(AddPeersView);