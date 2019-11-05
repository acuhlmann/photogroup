import React, { Component } from 'react';
import PropTypes from 'prop-types';

import Logger from 'js-logger';
import { withStyles } from '@material-ui/core/styles';

import LoaderView from './LoaderView';
import Encrypter from '../security/Encrypter';

import IconButton from "@material-ui/core/IconButton/IconButton";
import CloudUploadRounded from '@material-ui/icons/CloudUploadRounded';
import Dialog from "@material-ui/core/Dialog/Dialog";
import DialogContent from "@material-ui/core/DialogContent/DialogContent";
import DialogActions from "@material-ui/core/DialogActions/DialogActions";
import Button from "@material-ui/core/Button/Button";

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
        this.loader = loader;

        this.state = {
            open: false,
            disabled: true
        };

        model.emitter.on('webPeers', () => {

            if(this.state.disabled) {
                this.setState({disabled: false})
            }
        });
    }

    handleUpload(event) {
        this.show(true);

        const files = event.target.files;
        if(!files[0]) {
            return;
        }
        this.files = files;
        const file = this.file = files[0];
        Logger.info('handleUpload ' + file.name);

        this.uploaderDom = event.target || event.srcElement;
    }

    share() {

        this.seed(false);
        this.show(false);
    }

    secureShare() {

        this.seed(true);
        this.show(false);
    }

    cancel() {
        this.show(false);
        this.uploaderDom.value = '';
    }

    seed(secure) {

        const scope = this;
        Encrypter.encryptPic(this.file, secure, this.state.password, (file) => {

            scope.model.seed(file, secure, scope.file, () => {
                scope.uploaderDom.value = '';
            });
        });
    }

    show(open) {
        this.setState({
            open: open
        });
    }

    render() {
        const {classes} = this.props;

        return (
            <div>
                <input
                    accept="image/*"
                    className={classes.input}
                    id="contained-button-file" disabled={this.state.disabled}
                    type="file" onChange={this.handleUpload.bind(this)}
                />
                <label htmlFor="contained-button-file">
                    <IconButton
                        aria-haspopup="true"
                        color="inherit" variant="contained" component="span" disabled={this.state.disabled}
                    >
                        <CloudUploadRounded />
                    </IconButton>
                </label>
                <LoaderView loader={this.loader}/>

                <Dialog
                    open={this.state.open}
                    onClose={this.show.bind(this, false)}
                    //TransitionComponent={Transition}
                    keepMounted
                >
                    <DialogContent>
                        <div>
                            <Button variant="contained" onClick={this.share.bind(this, false)} color="secondary">
                                Share
                            </Button>
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
                        <Button onClick={this.cancel.bind(this, false)} color="primary">
                            Cancel
                        </Button>
                    </DialogActions>
                </Dialog>
            </div>
        );
    }
}

Uploader.propTypes = {
    classes: PropTypes.object.isRequired,
    model: PropTypes.object.isRequired,
    loader: PropTypes.object.isRequired,
};

export default withStyles(styles)(Uploader);