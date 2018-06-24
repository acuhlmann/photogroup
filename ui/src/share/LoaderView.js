import React, { Component } from 'react';
import PropTypes from 'prop-types';

import { withStyles } from '@material-ui/core/styles';

import CircularProgress from '@material-ui/core/CircularProgress';

const styles = theme => ({
    button: {
        margin: theme.spacing.unit,
    },
    input: {
        display: 'none',
    },
    progress: {
        margin: theme.spacing.unit * 2,
    },
});

class LoaderView extends Component {

    constructor(props) {
        super(props);

        this.loader = props.loader;
        this.loader.parent = this;

        this.state = {
            show: false,
            completed: 0,
            peers: 0,
            downloaded: 0,
            total: 0,
            remaining: 0,
            downloadspeed: '',
            uploadspeed: ''
        };

        const { classes } = props;
        this.classes = classes;
    }

    render() {
        const classes = this.classes;
        return (
            <div>
                {this.state.show ? <div>
                    <CircularProgress id="progressBar"
                                      className={classes.progress}
                                      variant="static"
                                      value={this.state.completed}
                    />
                    <label>peers {this.state.peers} </label>
                    <label>downloaded {this.state.downloaded} </label>
                    <label>total {this.state.total} </label>
                    <label>remaining {this.state.remaining} </label>
                    <label>download speed {this.state.downloadspeed} </label>
                    <label>upload speed {this.state.uploadspeed} </label>
                </div> : null}
            </div>
        );
    }
}

LoaderView.propTypes = {
    classes: PropTypes.object.isRequired,
};

export default withStyles(styles)(LoaderView);