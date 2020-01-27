import React, { Component } from 'react';
import PropTypes from 'prop-types';

import Logger from 'js-logger';
import { withStyles } from '@material-ui/core/styles';

import LoaderView from './LoaderView';

import IconButton from "@material-ui/core/IconButton/IconButton";
import CloudUploadRounded from '@material-ui/icons/CloudUploadRounded';
import Dialog from "@material-ui/core/Dialog/Dialog";
import DialogContent from "@material-ui/core/DialogContent/DialogContent";
import DialogActions from "@material-ui/core/DialogActions/DialogActions";
import CloseRounded from "@material-ui/core/SvgIcon/SvgIcon";

//import Slide from '@material-ui/core/Slide';
//import PasswordInput from "../security/PasswordInput";

/*function Transition(props) {
    return <Slide direction="down" {...props} />;
}*/

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

        const { classes, model, loader } = props;

        this.classes = classes;
        this.model = model;

        this.state = {
            visible: false,
            open: false,
            disabled: true, loadedAnything: false
        };

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
    }

    handleUpload(event) {

        const files = event.target.files;
        if(!files[0]) {
            return;
        }
        this.files = files;
        const file = this.file = files[0];
        Logger.info('handleUpload ' + file.name);

        this.uploaderDom = event.target || event.srcElement;
        //this.uploaderDom.value = '';

        this.seed(false);
    }

    cancel() {
        this.show(false);
        this.uploaderDom.value = '';
    }

    show(open) {
        this.setState({
            open: open
        });
    }

    seed(secure) {

        const scope = this;
        this.model.seed(this.file, false, this.file, () => {
            scope.uploaderDom.value = '';
        });

        /*const scope = this;
        Encrypter.encryptPic(this.file, secure, this.state.password, (file) => {

            scope.model.seed(file, secure, scope.file, () => {
                scope.uploaderDom.value = '';
            });
        });*/
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
                    //accept="image/*,video/*"
                    accept="image/*"
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
                        <div>
                            {/*<div>or encrypt with</div>
                            <span style={{display: 'flex'}}>
                                <PasswordInput onChange={value => this.setState({password: value})} />
                                <Button onClick={this.secureShare.bind(this, false)} color="primary">
                                    Encrypt
                                </Button>
                            </span>*/}
                        </div>
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