import React, { useState, useEffect, useRef, useCallback } from 'react';
import PropTypes from 'prop-types';

import Logger from 'js-logger';
import { withStyles } from '@mui/styles';

import LoaderView from './LoaderView';

import Box from "@mui/material/Box";
import Stack from "@mui/material/Stack";
import { headerLabelSx } from "./headerButtonSx";
import AddPhotoAlternateRounded from '@mui/icons-material/AddPhotoAlternateRounded';
import Dialog from "@mui/material/Dialog";
import DialogContent from "@mui/material/DialogContent";
import DialogActions from "@mui/material/DialogActions";
import DialogTitle from "@mui/material/DialogTitle";
import Typography from "@mui/material/Typography";
import Button from "@mui/material/Button";
import CircularProgress from "@mui/material/CircularProgress";

import { missingRoomKey, PRIVATE_NO_KEY, roomCryptoKey } from "../privateRoom";
import { sealFile } from "../security/roomKey";
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

function Uploader({classes, model, emitter, showButton = true}) {
    const [visible, setVisible] = useState(false);
    const [disabled, setDisabled] = useState(true);
    const [held, setHeld] = useState([]);
    const [unpacking, setUnpacking] = useState(false);
    const uploaderDomRef = useRef(null);

    useEffect(() => {
        const handleReadyToUpload = () => {
            setVisible(true);
            setDisabled(false);
        };

        model.emitter.on('readyToUpload', handleReadyToUpload);

        return () => {
            model.emitter.removeListener('readyToUpload', handleReadyToUpload);
        };
    }, [model.emitter]);

    const share = useCallback((files, isSecure, origFiles) => {
        model.seed(files, isSecure, origFiles, () => {
            if (uploaderDomRef.current) {
                uploaderDomRef.current.value = '';
            }
        });
    }, [model]);

    /**
     * In a private room every file is sealed with the room's key first; the
     * names in the torrent and on the server say nothing about the photos.
     */
    const proceed = useCallback(async (chosen) => {
        if(missingRoomKey()) {
            emitter.emit('showError', PRIVATE_NO_KEY);
            return;
        }
        const key = await roomCryptoKey();
        if(!key) {
            share(chosen);
            return;
        }
        try {
            const stamp = Date.now().toString(36);
            const sealed = await Promise.all(chosen.map((file, index) => sealFile(key, file, `photo-${stamp}-${index}`)));
            share(sealed, true, chosen);
        } catch(err) {
            Logger.error('sealing failed: ' + (err && err.message ? err.message : err));
            emitter.emit('showError', 'Could not encrypt the photos. Try again.');
        }
    }, [emitter, share]);

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
        }
        if(intact.length) {
            proceed(intact);
        }
    }, [emitter, proceed]);

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
        const files = held;
        setHeld([]);
        proceed(files);
    }, [held, proceed]);

    // Closing leaves the held files out.
    const closeHeld = useCallback(() => setHeld([]), []);

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
            {/* The one Add photos button in default and geek; simple mode has a big one in the page. */}
            {showButton && (
                <label htmlFor="contained-button-file" style={{cursor: disabled ? 'not-allowed' : 'pointer'}}>
                    <Button
                        aria-haspopup="true"
                        aria-label="Add photos and clips"
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
                        {unpacking ? <CircularProgress size={16} color="inherit" /> : <AddPhotoAlternateRounded />}
                        <Box component="span" sx={{ ...headerLabelSx, display: { xs: 'none', sm: 'inline' } }}>
                            {unpacking ? 'Unpacking…' : 'Add photos'}
                        </Box>
                    </Button>
                </label>
            )}

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
                            ? "Android removed the location from this photo, so PhotoGroup did not share it:"
                            : "Android removed the location from these photos, so PhotoGroup did not share them:"}
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
    showButton: PropTypes.bool,
};

export default withStyles(styles)(Uploader);