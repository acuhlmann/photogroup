import React, { useState, useEffect, useRef, useCallback } from 'react';
import PropTypes from 'prop-types';

import Logger from 'js-logger';
import { withStyles } from '@mui/styles';

import LoaderView from './LoaderView';

import IconButton from "@mui/material/IconButton";
import Box from "@mui/material/Box";
import Stack from "@mui/material/Stack";
import { headerLabelSx } from "./headerButtonSx";
import CloudUploadRounded from '@mui/icons-material/CloudUploadRounded';
import Dialog from "@mui/material/Dialog";
import DialogContent from "@mui/material/DialogContent";
import DialogActions from "@mui/material/DialogActions";
import DialogTitle from "@mui/material/DialogTitle";
import Typography from "@mui/material/Typography";
import CloseRounded from "@mui/icons-material/CloseRounded";
import Button from "@mui/material/Button";
import CircularProgress from "@mui/material/CircularProgress";

import PasswordInput from "../security/PasswordInput";
import WebCrypto from "../security/WebCrypto";
import { partitionStripped } from "../gallery/metadata/strippedLocation";
import { ACCEPT, ANDROID_ACCEPT, KEEP_LOCATION_STEPS, onAndroid } from "./androidUpload";
import { isZip, unpackZips } from "./unzipMedia";

const SHOWN_HELD = 5;


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
    const [password, setPassword] = useState('');
    const [files, setFiles] = useState(null);
    const [secure, setSecure] = useState(false);
    const [held, setHeld] = useState([]);
    const [unpacking, setUnpacking] = useState(false);
    const uploaderDomRef = useRef(null);
    // With encryption on, files that were fine wait here while the held ones
    // are settled, so the password dialog opens once, for all of them.
    const waitingRef = useRef([]);

    useEffect(() => {
        const handleReadyToUpload = () => {
            setVisible(true);
            setDisabled(false);
        };


        const handleEncrypt = (value) => {
            setSecure(value);
        };

        model.emitter.on('readyToUpload', handleReadyToUpload);
        model.emitter.on('encrypt', handleEncrypt);

        return () => {
            model.emitter.removeListener('readyToUpload', handleReadyToUpload);
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

    const proceed = useCallback((chosen) => {
        if(secure) {
            setFiles(chosen);
            setOpen(true);
        } else {
            share(chosen);
        }
    }, [secure, share]);

    /**
     * Share what was picked. On Android, zips are unpacked into the photos in
     * them, and files Android removed the location from are held back.
     */
    const receive = useCallback(async (picked) => {
        let chosen = Array.from(picked || []);
        if(!onAndroid()) {
            if(chosen.length) {
                proceed(chosen);
            }
            return;
        }
        if(chosen.some(isZip)) {
            setUnpacking(true);
            const { files, problems } = await unpackZips(chosen);
            setUnpacking(false);
            problems.forEach(message => emitter.emit('showError', message));
            chosen = files;
        }
        const { intact, stripped } = await partitionStripped(chosen);
        if(stripped.length) {
            setHeld(stripped);
            // Clear the input so the same files can be chosen again the right way.
            if(!intact.length && uploaderDomRef.current) {
                uploaderDomRef.current.value = '';
            }
            if(secure) {
                waitingRef.current = [...waitingRef.current, ...intact];
                return;
            }
        }
        // An empty pick (the picker closed after Pick again) still lets waiting files go ahead.
        const ready = [...waitingRef.current, ...intact];
        waitingRef.current = [];
        if(ready.length) {
            proceed(ready);
        }
    }, [emitter, proceed, secure]);

    const handleUpload = useCallback((event) => {
        uploaderDomRef.current = event.target || event.srcElement;
        receive(event.target.files);
    }, [receive]);

    // Drops on the gallery and photos shared from other apps come in this way too.
    useEffect(() => {
        emitter.on('filesSelected', receive);
        return () => emitter.removeListener('filesSelected', receive);
    }, [emitter, receive]);

    useEffect(() => {
        const input = uploaderDomRef.current;
        if(!input) {
            return undefined;
        }
        const handleCancel = () => receive([]);
        input.addEventListener('cancel', handleCancel);
        return () => input.removeEventListener('cancel', handleCancel);
    }, [receive, visible]);

    const pickAgain = useCallback(() => {
        setHeld([]);
        if(uploaderDomRef.current) {
            uploaderDomRef.current.click();
        }
    }, []);

    const shareWithoutLocation = useCallback(() => {
        const files = [...waitingRef.current, ...held];
        waitingRef.current = [];
        setHeld([]);
        proceed(files);
    }, [held, proceed]);

    // Closing leaves the held files out; anything waiting goes ahead.
    const closeHeld = useCallback(() => {
        const files = waitingRef.current;
        waitingRef.current = [];
        setHeld([]);
        if(files.length) {
            proceed(files);
        }
    }, [proceed]);

    const hasRoom = () => {
        const urlParams = new URLSearchParams(window.location.search);
        return urlParams.has('room');
    };

    if (!visible && !hasRoom()) {
        return null;
    }
    const android = onAndroid();

    return (
        <Stack direction="row" spacing={0.75} sx={{ alignItems: 'center' }}>
            <LoaderView emitter={emitter}/>
            {/* Leave audio in: image/video alone makes Chrome on Android use the photo picker, which blanks
                locations and can't reach Material Files. Zips are only offered on Android, where they keep locations. */}
            <input
                accept={android ? ANDROID_ACCEPT : ACCEPT}
                multiple
                style={{ position: 'absolute', width: 0, height: 0, opacity: 0, overflow: 'hidden', zIndex: -1 }}
                id="contained-button-file" 
                disabled={disabled}
                type="file" 
                onChange={handleUpload}
                ref={uploaderDomRef}
            />
            <label htmlFor="contained-button-file" style={{cursor: disabled ? 'not-allowed' : 'pointer'}}>
                <Button
                    aria-haspopup="true"
                    aria-label="Share photos"
                    variant="contained"
                    component="span"
                    disabled={disabled || unpacking}
                    aria-busy={unpacking}
                    sx={{
                        height: 34,
                        minWidth: 34,
                        px: { xs: 1, sm: 1.5 },
                        gap: 0.75,
                        borderRadius: '8px',
                        '& .MuiSvgIcon-root': { fontSize: 18 },
                    }}
                >
                    {unpacking ? <CircularProgress size={16} color="inherit" /> : <CloudUploadRounded />}
                    <Box component="span" sx={{ ...headerLabelSx, display: { xs: 'none', sm: 'inline' } }}>
                        {unpacking ? 'Unpacking…' : 'Share'}
                    </Box>
                </Button>
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

            <Dialog
                open={held.length > 0}
                onClose={closeHeld}
                maxWidth="xs"
                fullWidth
                aria-labelledby="location-held-title"
            >
                <DialogTitle id="location-held-title">Location removed</DialogTitle>
                <DialogContent>
                    <Typography variant="body2" sx={{ mb: 1 }}>
                        {held.length === 1
                            ? "Android removed where this was taken before handing it over, so it wasn't shared:"
                            : "Android removed where these were taken before handing them over, so they weren't shared:"}
                    </Typography>
                    <Box component="ul" data-testid="location-held" sx={{ m: 0, mb: 1.5, pl: 2.5 }}>
                        {held.slice(0, SHOWN_HELD).map((file, index) => (
                            <Typography component="li" variant="body2" key={index} sx={{ wordBreak: 'break-all' }}>
                                {file.name}
                            </Typography>
                        ))}
                        {held.length > SHOWN_HELD && (
                            <Typography component="li" variant="body2" sx={{ color: 'text.secondary' }}>
                                and {held.length - SHOWN_HELD} more
                            </Typography>
                        )}
                    </Box>
                    <Typography variant="body2" sx={{ color: 'text.secondary' }}>
                        To keep the location, tap Pick again. {KEEP_LOCATION_STEPS}
                    </Typography>
                </DialogContent>
                <DialogActions sx={{ px: 3, pb: 2 }}>
                    <Button onClick={shareWithoutLocation} sx={{ textTransform: 'none' }}>
                        Share without location
                    </Button>
                    <Button onClick={pickAgain} variant="contained" sx={{ textTransform: 'none' }}>
                        Pick again
                    </Button>
                </DialogActions>
            </Dialog>

        </Stack>
    );
}

Uploader.propTypes = {
    classes: PropTypes.object.isRequired,
    model: PropTypes.object.isRequired,
    emitter: PropTypes.object.isRequired,
};

export default withStyles(styles)(Uploader);