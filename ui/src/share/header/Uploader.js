import React, { useState, useEffect, useRef, useCallback } from 'react';
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

function Uploader({classes, model, emitter}) {
    const [visible, setVisible] = useState(false);
    const [open, setOpen] = useState(false);
    const [disabled, setDisabled] = useState(true);
    const [loadedAnything, setLoadedAnything] = useState(false);
    const [password, setPassword] = useState('');
    const [files, setFiles] = useState(null);
    const [secure, setSecure] = useState(false);
    const uploaderDomRef = useRef(null);

    useEffect(() => {
        const handleReadyToUpload = () => {
            setVisible(true);
            setDisabled(false);
        };

        const handleLoadedAnything = () => {
            setLoadedAnything(true);
        };

        const handleEncrypt = (value) => {
            setSecure(value);
        };

        model.emitter.on('readyToUpload', handleReadyToUpload);
        model.emitter.on('loadedAnything', handleLoadedAnything);
        model.emitter.on('encrypt', handleEncrypt);

        return () => {
            model.emitter.removeListener('readyToUpload', handleReadyToUpload);
            model.emitter.removeListener('loadedAnything', handleLoadedAnything);
            model.emitter.removeListener('encrypt', handleEncrypt);
        };
    }, [model.emitter]);

    const share = useCallback((files, isSecure, origFiles) => {
        model.seed(files, isSecure, origFiles, () => {
            if (uploaderDomRef.current) {
                uploaderDomRef.current.value = '';
            }
        });
    }, [model]);

    const secureShare = useCallback(async () => {
        const crypto = new WebCrypto();
        const result = await crypto.encryptFile(files, password);
        //const text = await result.blob.text();

        Logger.info('secureShare ' + result);
        share([result].map((item, index) => item.blob), true, files);
        setOpen(false);
    }, [files, password, share]);

    const handleUpload = useCallback((event) => {
        const uploadedFiles = event.target.files;
        if(!uploadedFiles[0]) {
            return;
        }

        uploaderDomRef.current = event.target || event.srcElement;

        if(secure) {
            setFiles(uploadedFiles);
            setOpen(true);
        } else {
            share(uploadedFiles);
        }
    }, [secure, share]);

    const hasRoom = () => {
        const urlParams = new URLSearchParams(window.location.search);
        return urlParams.has('room');
    };

    if (!visible && !hasRoom()) {
        return null;
    }

    return (
        <div>
            <LoaderView emitter={emitter}/>
            <input
                accept="image/*,video/*,audio/*"
                multiple
                style={{
                    position: 'absolute',
                    top: loadedAnything ? '-15px' : '0px',
                    width: 0,
                    height: 0,
                    opacity: 0,
                    overflow: 'hidden',
                    zIndex: -1,
                }}
                className={classes.input}
                id="contained-button-file" 
                disabled={disabled}
                type="file" 
                onChange={handleUpload}
                ref={uploaderDomRef}
            />
            <label htmlFor="contained-button-file" style={{cursor: disabled ? 'not-allowed' : 'pointer'}}>
                <IconButton
                    aria-haspopup="true"
                    color="inherit" 
                    variant="contained"
                    component="span"
                    style={{
                        position: 'relative',
                        top: loadedAnything ? '-15px' : '0px',
                    }}
                    disabled={disabled}
                >
                    <CloudUploadRounded />
                </IconButton>
            </label>

            <Dialog
                open={open}
                onClose={() => setOpen(false)}
                keepMounted
            >
                <DialogContent>
                    <span style={{display: 'flex'}}>
                        <PasswordInput onChange={setPassword} />
                        <Button onClick={secureShare} color="primary">
                            Encrypt
                        </Button>
                    </span>
                </DialogContent>
                <DialogActions>
                    <IconButton onClick={() => setOpen(false)}>
                        <CloseRounded />
                    </IconButton>
                </DialogActions>
            </Dialog>
        </div>
    );
}

Uploader.propTypes = {
    classes: PropTypes.object.isRequired,
    model: PropTypes.object.isRequired,
    emitter: PropTypes.object.isRequired,
};

export default withStyles(styles)(Uploader);