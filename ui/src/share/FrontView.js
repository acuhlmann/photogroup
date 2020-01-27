import React, { Component } from 'react';
import PropTypes from 'prop-types';

import { withStyles } from '@material-ui/core/styles';

import Button from '@material-ui/core/Button';
import PlayCircleFilledWhiteRoundedIcon from '@material-ui/icons/PlayCircleFilledWhiteRounded';
import {Typography} from "@material-ui/core";
import CropFreeRounded from '@material-ui/icons/CropFreeRounded';
import SettingsVoiceRounded from '@material-ui/icons/SettingsVoiceRounded';
import IconButton from "@material-ui/core/IconButton";

const styles = theme => ({
    button: {
        margin: theme.spacing(1),
    },
    vertical: {
        display: 'flex',
        flexDirection: 'column'
    },
    horizontal: {
        display: 'flex',
        flexDirection: 'row',
        alignItems: 'center',
        justifyContent: 'center'
    }
});

class FrontView extends Component {

    constructor(props) {
        super(props);
        this.state = {
            show: false,
            visible: false
        };

        props.master.emitter.on('openRoomEnd', () => {
            this.setState({show: true});
        });
        props.master.emitter.on('hideFrontView', () => {
            this.setState({show: false, visible: false});
        });
        props.master.emitter.on('iceDone', () => {
            this.setState({visible: true});
        });
    }

    async openRoom() {

        const master = this.props.master;
        master.emitter.emit('openRoomStart');

        await master.findExistingContent(master.service.createRoom, true);
        master.service.changeUrl('room', master.service.id);

        master.emitter.emit('openRoomEnd');
        master.emitter.emit('readyToUpload');
    }

    buildView(master, show, classes) {
        return !show ? <div style={{
                            marginTop: '50px'
                        }}>
                    <Typography variant={"body2"}>One peer needs to...</Typography>
                    <Button onClick={this.openRoom.bind(this)}
                            variant="contained"
                            color="primary"
                            className={classes.button}
                            endIcon={<PlayCircleFilledWhiteRoundedIcon/>}
                    >
                        start Private Room
                    </Button>
                <Typography variant={"body2"}>or join another room via</Typography>
                <span className={classes.horizontal}>
                    <Typography variant={"body2"}>Scanning a QR code</Typography>
                    <IconButton
                        onClick={() => master.emitter.emit('openQr')}
                        color="inherit">
                        <CropFreeRounded />
                    </IconButton>
                </span>
                <span className={classes.horizontal}>
                        <Typography variant={"body2"}>Listening to an audio signal</Typography>
                        <IconButton color="primary"
                            onClick={() => master.emitter.emit('openRecorderChirp')}>
                            <SettingsVoiceRounded />
                        </IconButton>
                        <IconButton color="secondary"
                            onClick={() => master.emitter.emit('openRecorder')}>
                            <SettingsVoiceRounded />
                        </IconButton>
                        <IconButton color="inherit"
                                    onClick={() => master.emitter.emit('openRecorderUltrasonic')}>
                            <SettingsVoiceRounded />
                        </IconButton>
                    </span>
            </div> : '';
    }

    hasRoom() {
        const urlParams = new URLSearchParams(window.location.search);
        return urlParams.has('room');
    }

    render() {

        const {classes, master} = this.props;
        const {show, visible} = this.state;

        const hasRoom = this.hasRoom();

        return (
            !hasRoom && visible ? <div>

                {this.buildView(master, show, classes)}

            </div> : ''
        );
    }
}

FrontView.propTypes = {
    classes: PropTypes.object.isRequired,
    master: PropTypes.object.isRequired,
};

export default withStyles(styles)(FrontView);