import React, { Component } from 'react';
import PropTypes from 'prop-types';

import Logger from 'js-logger';

import { withStyles } from '@material-ui/core/styles';
import Button from '@material-ui/core/Button';
import IconButton from '@material-ui/core/IconButton';
import Settings from '@material-ui/icons/Settings';

import Dialog from '@material-ui/core/Dialog';
import DialogContent from '@material-ui/core/DialogContent';
import DialogTitle from '@material-ui/core/DialogTitle';
import DialogActions from '@material-ui/core/DialogActions';
import Slide from '@material-ui/core/Slide';

function Transition(props) {
    return <Slide direction="down" {...props} />;
}

const styles = theme => ({

});

class LogView extends Component {

    constructor(props) {
        super(props);

        this.state = {
            messages: [],
            open: false,
        };

        const { classes } = props;
        this.classes = classes;

        Logger.setHandler((messages, context) => {
            this.log(messages[0], context.level.name);
        });
    }

    componentDidMount() {
        this.mounted = true;
    }

    log(message, level) {
        const msg = level + ': ' + message;
        console.log(msg);
        this.state.messages.unshift(msg);
        if(this.mounted) {
            this.setState({messages: this.state.messages});
        }
    }

    showLogs() {
        this.setState({
            open: true,
            messages: this.state.messages
        });
    }

    handleClose() {
        this.setState({ open: false });
    }

    render() {
        const messages = this.state.messages.map((value, index) => (
            <div key={index}>
                {value}
            </div>
        ));

        return (
            <div>
                <IconButton
                    aria-haspopup="true"
                    onClick={this.showLogs.bind(this)}
                    color="inherit"
                >
                    <Settings />
                </IconButton>

                <Dialog
                    open={this.state.open}
                    onClose={this.handleClose.bind(this)}
                    TransitionComponent={Transition}
                    keepMounted
                >
                    <DialogTitle>just some boooring logs</DialogTitle>
                    <DialogActions>
                        <Button onClick={this.handleClose.bind(this)} color="primary">
                            Close
                        </Button>
                    </DialogActions>
                    <DialogContent>
                        {messages}
                    </DialogContent>
                </Dialog>
            </div>
        );
    }
}

LogView.propTypes = {
    classes: PropTypes.object.isRequired,
    emitter: PropTypes.object.isRequired,
};

export default withStyles(styles)(LogView);