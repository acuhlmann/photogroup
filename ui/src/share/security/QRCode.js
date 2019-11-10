import React, { Component } from 'react';
import PropTypes from 'prop-types';

import { withStyles } from '@material-ui/core/styles';

import QRCode from "qrcode.react";
import cryptoRandomString from 'crypto-random-string';

import Button from '@material-ui/core/Button';
import Icon from '@material-ui/core/Icon';
import SaveIcon from '@material-ui/icons/Save';
import PlayCircleFilledWhiteRounded from '@material-ui/icons/Save';


const styles = theme => ({
    button: {
        margin: theme.spacing(1),
    },
});

class QRCode extends Component {

    constructor(props) {
        super(props);
    }

    render() {
        const url = window.location.href + cryptoRandomString({length: 10, type: 'url-safe'});
        //PlayCircleFilledWhiteRounded
        return (
            <div>
                <Button
                    variant="contained"
                    color="primary"
                    className={classes.button}
                    endIcon={<Icon>send</Icon>}
                >
                    Start Private Room
                </Button>
                <QRCode value={url} />
            </div>
        );
    }
}

QRCode.propTypes = {
    classes: PropTypes.object.isRequired,
};

export default withStyles(styles)(QRCode);