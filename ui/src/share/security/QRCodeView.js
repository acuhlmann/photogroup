import React, { Component } from 'react';
import PropTypes from 'prop-types';

import { withStyles } from '@material-ui/core/styles';

import Button from '@material-ui/core/Button';
import PlayCircleFilledWhiteRoundedIcon from '@material-ui/icons/PlayCircleFilledWhiteRounded';
import {Typography} from "@material-ui/core";
import CropFreeRounded from '@material-ui/icons/CropFreeRounded';
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

class QRCodeView extends Component {

    constructor(props) {
        super(props);
        this.state = {
            showQR: false
        };

        props.master.emitter.on('openRoomEnd', () => {
            this.setState({showQR: true});
        })
    }

    async openRoom() {

        const master = this.props.master;
        master.emitter.emit('openRoomStart');

        await master.findExistingContent(master.service.createRoom);
        master.service.changeUrl('room', master.service.id);

        master.emitter.emit('openRoomEnd');
    }

    buildQRView(master, showQR, classes) {
        return !showQR ? <div style={{
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
                <span className={classes.horizontal}>
                    <Typography variant={"body2"}>or join another room</Typography>
                    <IconButton
                        onClick={() => master.emitter.emit('openQr')}
                        color="inherit">
                        <CropFreeRounded />
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
        const {showQR} = this.state;

        const hasRoom = this.hasRoom();

        return (
            !hasRoom ? <div>

                {this.buildQRView(master, showQR, classes)}

            </div> : ''
        );
    }
}

QRCodeView.propTypes = {
    classes: PropTypes.object.isRequired,
    master: PropTypes.object.isRequired,
};

export default withStyles(styles)(QRCodeView);