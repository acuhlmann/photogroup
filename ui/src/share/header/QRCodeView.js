import React, { Component } from 'react';
import PropTypes from 'prop-types';

import { withStyles } from '@material-ui/core/styles';
import Button from '@material-ui/core/Button';
import IconButton from '@material-ui/core/IconButton';
import CropFreeRounded from '@material-ui/icons/CropFreeRounded';

import Dialog from '@material-ui/core/Dialog';
import DialogContent from '@material-ui/core/DialogContent';
import DialogActions from '@material-ui/core/DialogActions';
import QRCode from "qrcode.react";
import Slide from '@material-ui/core/Slide';

function Transition(props) {
    return <Slide direction="down" {...props} />;
}

const styles = theme => ({

});

class QRCodeView extends Component {

    constructor(props) {
        super(props);

        this.state = {
            open: false,
        };

        const { classes } = props;
        this.classes = classes;
    }

    show(open) {
        this.setState({
            open: open
        });
    }

    render() {
        const url = window.location.href;

        return (
            <div>
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
                    TransitionComponent={Transition}
                    keepMounted
                >
                    <DialogContent>
                        <QRCode value={url} />
                    </DialogContent>
                    <DialogActions>
                        <Button onClick={this.show.bind(this, false)} color="primary">
                            Close
                        </Button>
                    </DialogActions>
                </Dialog>
            </div>
        );
    }
}

QRCodeView.propTypes = {
    classes: PropTypes.object.isRequired,
};

export default withStyles(styles)(QRCodeView);