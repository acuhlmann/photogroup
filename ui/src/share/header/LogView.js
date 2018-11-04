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

import RoomsService from '../RoomsService';
import moment from "moment";

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
            const date = moment().format("HH:mm:ss");
            this.log(date + ' ' + messages[0], context.level.name);
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
        LogView.getAll().then(dom => {
            this.setState({
                urls: dom
            });
        });

        this.setState({
            open: true
        });
    }

    handleClose() {
        this.setState({ open: false });
    }

    static handleReset() {
        RoomsService.deleteAll();
    }

    static getAll() {
        return RoomsService.getAll().then(result => {
            let msg = '';
            for (let key in result) {
                //msg += 'Room: ' + key + '\n\n';
                const urls = result[key];
                msg += 'Shared: ' + urls.length + '\n\n';
                urls.forEach(item => {
                    const parsed = window.parsetorrent(item.url);
                    const key = parsed.infoHash;
                    msg += key + ' '  + item.secure + '\n';
                });
            }
            return msg;
        });
    }

    render() {
        const messageContent = this.state.messages
            .map((value, index) => (
            <div key={index}>
                {value}
            </div>
            ))
            .concat(
                <Button key='delete' onClick={LogView.handleReset.bind(this)} color="primary">
                    Delete server state
                </Button>);

        const messages = <div>
                <div>{this.state.urls}</div>
                <div>{messageContent}</div>
            </div>;

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
                    <DialogTitle>Debugging</DialogTitle>
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