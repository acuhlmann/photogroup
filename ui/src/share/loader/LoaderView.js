import React, { Component } from 'react';
import PropTypes from 'prop-types';

import { withStyles } from '@material-ui/core/styles';

import CircularProgress from '@material-ui/core/CircularProgress';

const styles = theme => ({
    button: {
        margin: theme.spacing(1),
    },
    input: {
        display: 'none',
    },
    progress: {
        margin: theme.spacing(2),
    },
});

class LoaderView extends Component {

    constructor(props) {
        super(props);

        this.loader = props.loader;
        this.loader.parent = this;

        this.state = {
            show: false,
            completed: 0
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
                </div> : null}
            </div>
        );
    }
}

LoaderView.propTypes = {
    classes: PropTypes.object.isRequired,
};

export default withStyles(styles)(LoaderView);