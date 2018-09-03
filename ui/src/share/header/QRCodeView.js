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

    componentDidMount() {
        this.mounted = true;
    }

    show() {

        this.setState({
            open: true
        });
    }

    handleClose() {
        this.setState({ open: false });
    }

    render() {
        const url = window.location.href;

        return (
            <div>
                <IconButton
                    aria-haspopup="true"
                    onClick={this.show.bind(this)}
                    color="inherit"
                >
                    <CropFreeRounded />
                </IconButton>

                <Dialog
                    open={this.state.open}
                    onClose={this.handleClose.bind(this)}
                    aria-labelledby="alert-dialog-title"
                    aria-describedby="alert-dialog-description"
                >
                    <DialogContent>
                        <QRCode value={url} />
                    </DialogContent>
                    <DialogActions>
                        <Button onClick={this.handleClose.bind(this)} color="primary">
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