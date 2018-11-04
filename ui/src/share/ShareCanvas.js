import React, { Component } from 'react';
import PropTypes from 'prop-types';
import Gallery from "./gallery/Gallery";

import { withStyles } from '@material-ui/core/styles';
import { createMuiTheme } from '@material-ui/core/styles';

const styles = theme => createMuiTheme({
    typography: {
        useNextVariants: true,
    },
});

class ShareCanvas extends Component {

    constructor(props) {
        super(props);
        this.gallery = props.gallery;
    }

    render() {
        return (
            <Gallery model={this.gallery} />
        );
    }
}

ShareCanvas.propTypes = {
    classes: PropTypes.object.isRequired,
    gallery: PropTypes.object.isRequired,
};

export default withStyles(styles)(ShareCanvas);