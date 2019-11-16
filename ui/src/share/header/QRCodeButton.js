import React, { Component } from 'react';
import PropTypes from 'prop-types';

import { withStyles } from '@material-ui/core/styles';
import CloseRounded from '@material-ui/icons/CloseRounded';
import IconButton from '@material-ui/core/IconButton';
import CropFreeRounded from '@material-ui/icons/CropFreeRounded';

import Dialog from '@material-ui/core/Dialog';
import DialogContent from '@material-ui/core/DialogContent';
import DialogActions from '@material-ui/core/DialogActions';
import QRCode from "qrcode.react";
import {Typography} from "@material-ui/core";
import Button from "@material-ui/core/Button";
import LinkRounded from '@material-ui/icons/LinkRounded';
import copy from "clipboard-copy";
import QrReader from 'react-qr-reader'
import PlayCircleFilledWhiteRoundedIcon from '@material-ui/icons/PlayCircleFilledWhiteRounded';
//import Slide from '@material-ui/core/Slide';

/*function Transition(props) {
    return <Slide direction="down" {...props} />;
}*/

const styles = theme => ({
    vertical: {
        display: 'flex',
        flexDirection: 'column',
        alignItems: 'center',
        justifyContent: 'center'
    },
});

class QRCodeButton extends Component {

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
                visible: true
            });
        });

        props.master.emitter.on('openRoomEnd', () => {
            this.setState({
                open: true,
                createdRoom: true
            });
        });

        props.master.emitter.on('openQr', () => {
            this.setState({
                visible: true,
                open: true,
                openQr: true
            });
        });

        this.handleScan = this.handleScan.bind(this)
    }

    async handleScan(data){

        if(!data) return;

        const url = new URL(data);
        const urlParams = new URLSearchParams(url.search);
        if(urlParams.has('room')) {

            this.setState({
                scannerResult: data,
            });

            const master = this.props.master;
            master.service.id = urlParams.get('room');
            await master.findExistingContent();
            master.emitter.emit('openRoomStart');
            master.emitter.emit('openRoomEnd');

            this.show(false);
        }
    }
    handleScanError(err){
        console.error(err)
    }

    show(open) {

        this.setState({
            open: open,
            openQr: !open ? false : this.state.openQr
        });
    }

    async shareLink(url) {

        copy(url);
    }

    hasRoom() {
        const urlParams = new URLSearchParams(window.location.search);
        return urlParams.has('room');
    }

    render() {
        const {classes, master} = this.props;
        const {visible, createdRoom, openQr} = this.state;
        const url = window.location.href + '?room=' + master.service.id;
        const hasRoom = this.hasRoom();

        const scannerStyle = {
            height: 300,
            width: 300,
        };

        return (
            visible || hasRoom ? <div>
                <IconButton
                    aria-haspopup="true"
                    onClick={this.show.bind(this, true)}
                    color="inherit"
                >
                    <CropFreeRounded />
                </IconButton>

                <Dialog
                    open={this.state.open}
                    onClose={this.show.bind(this, false)}
                    //TransitionComponent={Transition}
                    keepMounted
                >
                    <DialogContent className={classes.vertical} style={{
                        textAlign: 'center'
                    }}>

                        {
                            hasRoom || createdRoom ? <span style={{
                                marginBottom: '20px'
                            }}>
                                <Typography variant="body1">Room created, share this with your peers...</Typography>
                                <span className={classes.vertical} style={{
                                    marginTop: '10px'
                                }}>
                                    <QRCode value={url} />
                                    <Typography variant={"caption"}>{master.service.id}</Typography>
                                </span>
                                <span className={classes.vertical} style={{
                                    marginTop: '10px'
                                }}>
                                    <Typography variant={"body1"}>or</Typography>
                                    <Button onClick={this.shareLink.bind(this, url)}
                                            variant="contained"
                                            color="primary"
                                            className={classes.button}
                                            endIcon={<LinkRounded/>}
                                    >
                                    copy link
                                    </Button>
                                </span>
                                </span> : <span></span>
                            }
                        {
                            !openQr ?
                                <Button onClick={() => {
                                    this.setState({openQr: true})
                                }}
                                        variant="contained"
                                        color="primary"
                                        className={classes.button}
                                        endIcon={<PlayCircleFilledWhiteRoundedIcon/>}
                                >
                                    Join other Room with QR-Reader
                                </Button> :
                                <div>
                                    <QrReader
                                        delay={this.state.scannerDelay}
                                        facingMode={"environment"}
                                        showViewFinder={true}
                                        style={scannerStyle}
                                        onError={this.handleScanError}
                                        onScan={this.handleScan}/>
                                    <Typography variant={"caption"}>{this.state.scannerResult}</Typography>
                                </div>
                        }
                    </DialogContent>
                    <DialogActions>
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

QRCodeButton.propTypes = {
    classes: PropTypes.object.isRequired,
    master: PropTypes.object.isRequired,
};

export default withStyles(styles)(QRCodeButton);