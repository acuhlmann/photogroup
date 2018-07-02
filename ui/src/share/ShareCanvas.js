import React, { Component } from 'react';
import PropTypes from 'prop-types';

import QRCode from 'qrcode.react';
import Uploader from './loader/Uploader';
import Gallery from "./gallery/Gallery";

import { withStyles } from '@material-ui/core/styles';
const styles = theme => ({

});

class ShareCanvas extends Component {

    constructor(props) {
        super(props);

        this.state = {
            numPeer: 0
        };
        const { classes, master, gallery } = props;

        master.emitter.on('update', this.update, this);

        this.classes = classes;
        this.master = master;
        this.gallery = gallery;
    }

    update() {
        this.setState({numPeer: this.master.numPeer});
    }

    render() {
        const url = window.location.href;

        return (
            <div>
                <QRCode value={url} />
                <Uploader model={this.master.torrentAddition}
                          loader={this.master.torrentAddition.loader} />
                <div>Peers {this.state.numPeers}</div>
                <Gallery model={this.gallery} />
            </div>
        );
    }
}

ShareCanvas.propTypes = {
    classes: PropTypes.object.isRequired,
    master: PropTypes.object.isRequired,
    gallery: PropTypes.object.isRequired,
};

export default withStyles(styles)(ShareCanvas);