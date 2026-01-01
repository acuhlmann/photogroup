import React, { Component } from 'react';
import PropTypes from 'prop-types';

import { withStyles } from '@mui/styles';

import Button from '@mui/material/Button';
import PlayCircleFilledWhiteRoundedIcon from '@mui/icons-material/PlayCircleFilledWhiteRounded';
import {Typography} from "@mui/material";
import CropFreeRounded from '@mui/icons-material/CropFreeRounded';
import SettingsVoiceRounded from '@mui/icons-material/SettingsVoiceRounded';
import IconButton from "@mui/material/IconButton";
import Slide from "@mui/material/Slide";

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

        try {
            await master.findExistingContent(master.service.createRoom, true);
            master.service.changeUrl('room', master.service.id);

            master.emitter.emit('openRoomEnd');
            master.emitter.emit('readyToUpload');
        } catch (error) {
            console.error('Failed to create room:', error);
            // Emit error event so other components can show user feedback
            master.emitter.emit('roomCreationError', error);
            // Still emit openRoomEnd to reset UI state
            master.emitter.emit('openRoomEnd');
            
            // Show error message to user
            if (error.message && error.message.includes('Failed to fetch') || error.message.includes('NetworkError')) {
                master.emitter.emit('showError', 'Cannot connect to server. Please make sure the backend server is running on port 8081.');
            } else {
                master.emitter.emit('showError', `Failed to create room: ${error.message || 'Unknown error'}`);
            }
        }
    }

    buildView(master, show, classes) {
        return <div style={{
                            marginTop: '50px'
                        }}>
                    <Typography variant={"body2"}>One peer needs to...</Typography>
                    <Button onClick={this.openRoom.bind(this)}
                            variant="contained"
                            color="primary"
                            className={classes.button}
                            endIcon={<PlayCircleFilledWhiteRoundedIcon/>}
                    >
                        start a Private Room
                    </Button>
                <Typography variant={"body2"}>or join another room via</Typography>
                <span className={classes.vertical}>
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
                        <IconButton color="secondary"
                            onClick={() => master.emitter.emit('openRecorder')}>
                            <SettingsVoiceRounded />
                        </IconButton>
                        <IconButton color="inherit"
                                    onClick={() => master.emitter.emit('openRecorderUltrasonic')}>
                            <SettingsVoiceRounded />
                        </IconButton>
                    </span>
                </span>
            </div>
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
            <Slide direction="up" in={!hasRoom && visible} mountOnEnter unmountOnExit>
                <div>
                    {this.buildView(master, show, classes)}
                </div>
            </Slide>
        );
    }
}

FrontView.propTypes = {
    classes: PropTypes.object.isRequired,
    master: PropTypes.object.isRequired,
};

export default withStyles(styles)(FrontView);