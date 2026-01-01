import React, { Component } from 'react';
import PropTypes from 'prop-types';

import Logger from 'js-logger';
import { withStyles } from '@mui/styles';

import LoaderView from './LoaderView';

import IconButton from "@mui/material/IconButton";
import CloudUploadRounded from '@mui/icons-material/CloudUploadRounded';
import Dialog from "@mui/material/Dialog";
import DialogContent from "@mui/material/DialogContent";
import DialogActions from "@mui/material/DialogActions";
import CloseRounded from "@mui/icons-material/CloseRounded";
import Button from "@mui/material/Button";

import PasswordInput from "../security/PasswordInput";
import WebCrypto from "../security/WebCrypto";


const styles = theme => ({

    root: {
        maxWidth: 300,
    },
    input: {
        display: 'none',
    },
});

class Uploader extends Component {

    constructor(props) {
        super(props);

        const { classes, model } = props;

        this.classes = classes;
        this.model = model;

        this.state = {
            visible: false,
            open: false,
            disabled: true, loadedAnything: false,
            password: '', files: null
        };
    }

    componentDidMount() {
        const { model } = this.props;

        model.emitter.on('readyToUpload', () => {
            this.setState({
                visible: true,
                disabled: false
            });
        });

        model.emitter.on('loadedAnything', () => {
            this.setState({
                loadedAnything: true
            });
        });

        model.emitter.on('encrypt', (value) => {
            this.setState({
                secure: value
            });
        });
    }

    handleUpload(event) {

        const files = event.target.files;
        if(!files[0]) {
            return;
        }

        this.uploaderDom = event.target || event.srcElement;

        if(this.state.secure) {
            this.setState({files: files, open: true});
        } else {
            this.share(files);
        }
    }

    share(files, isSecure, origFiles) {
        const self = this;
        this.model.seed(files, isSecure, origFiles, () => {
            self.uploaderDom.value = '';
        });
    }

    async secureShare() {
        const {files, password} = this.state;

        const crypto = new WebCrypto();
        const result = await crypto.encryptFile(files, password);
        //const text = await result.blob.text();

        Logger.info('secureShare ' + result);
        this.share([result].map((item, index) => item.blob), true, files);
        this.show(false);
    }

    cancel() {
        this.show(false);
        this.uploaderDom.value = '';
    }

    show(open) {
        this.setState({open: open});
    }

    hasRoom() {
        const urlParams = new URLSearchParams(window.location.search);
        return urlParams.has('room');
    }

    render() {
        const {classes, emitter} = this.props;
        const {visible, disabled, loadedAnything} = this.state;
        const hasRoom = this.hasRoom();

        return (
            visible || hasRoom ? <div>

                <LoaderView emitter={emitter}/>
                <input
                    accept="image/*,video/*,audio/*"
                    //accept="image/*"
                    multiple
                    style={{
                        position: 'absolute',
                        top: loadedAnything ? '-15px' : '0px',
                    }}
                    className={classes.input}
                    id="contained-button-file" disabled={disabled}
                    type="file" onChange={this.handleUpload.bind(this)}
                />
                <label htmlFor="contained-button-file">
                    <IconButton
                        aria-haspopup="true"
                        color="inherit" variant="contained"
                        component="span"
                        style={{
                            position: 'relative',
                            //top: '-15px',
                            top: loadedAnything ? '-15px' : '0px',
                        }}
                        disabled={disabled}
                    >
                        <CloudUploadRounded />
                    </IconButton>
                </label>

                <Dialog
                    open={this.state.open}
                    onClose={this.show.bind(this, false)}
                    //TransitionComponent={Transition}
                    keepMounted
                >
                    <DialogContent>
                        <span style={{display: 'flex'}}>
                            <PasswordInput onChange={value => this.setState({password: value})} />
                            <Button onClick={this.secureShare.bind(this)} color="primary">
                                Encrypt
                            </Button>
                        </span>
                    </DialogContent>
                    <DialogActions>
                        <IconButton
                            onClick={this.show.bind(this, false)}
                        >
                            <CloseRounded />
                        </IconButton>
                    </DialogActions>
                </Dialog>
            </div> : <div></div>
        );
    }
}

Uploader.propTypes = {
    classes: PropTypes.object.isRequired,
    model: PropTypes.object.isRequired,
};

export default withStyles(styles)(Uploader);