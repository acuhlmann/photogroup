import React, { Component } from 'react';
import PropTypes from 'prop-types';

import QRCode from 'qrcode.react';
import Uploader from './Uploader';
import Gallery from "./Gallery";

import { withStyles } from '@material-ui/core/styles';
const styles = theme => ({

});

class ShareCanvas extends Component {

    constructor(props) {
        super(props);

        this.state = {
            numPeer: 0
        };
        const { classes, master } = props;

        master.emitter.on('update', this.update, this);

        this.classes = classes;
        this.master = master;
    }

    log(message) {
        this.master.log(message);
    }

    update() {
        this.setState({numPeer: this.master.numPeer});
    }

    render() {
        const url = window.location.href;

        return (
            <div>
                <QRCode value={url} />
                <Uploader master={this.master.torrentAddition} />
                <div>Peers {this.state.numPeers}</div>
                <Gallery model={this.master.gallery} />
            </div>
        );
    }
}

ShareCanvas.propTypes = {
    classes: PropTypes.object.isRequired,
    master: PropTypes.object.isRequired,
};

export default withStyles(styles)(ShareCanvas);