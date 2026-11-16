import React, { useRef, useState } from 'react';
import PropTypes from 'prop-types';
import Box from '@mui/material/Box';
import Button from '@mui/material/Button';
import Dialog from '@mui/material/Dialog';
import DialogContent from '@mui/material/DialogContent';
import DialogTitle from '@mui/material/DialogTitle';
import IconButton from '@mui/material/IconButton';
import Stack from '@mui/material/Stack';
import Typography from '@mui/material/Typography';
import CloseRounded from '@mui/icons-material/CloseRounded';
import QrCode2Rounded from '@mui/icons-material/QrCode2Rounded';
import QrCodeScannerRounded from '@mui/icons-material/QrCodeScannerRounded';
import LightReceive, { RECEIVE_TITLE } from './LightReceive';
import LightSendMany, { SEND_MANY_TITLE, itemsOfFiles } from './LightSendMany';
import { MAX_LIGHT_BYTES } from './lightFrames';

export const TRIGGER_LABEL = 'No network? Send or get photos by camera';
export const SEND_ONLY_LABEL = 'No network? Send photos by camera';
export const CHOOSER_TITLE = 'Photos by camera';
export const NO_NETWORK_TEXT = 'With no network and no room: from one screen to the camera of the other phone.';
export const FILES_TOO_LARGE = 'These files are too large to send by camera.';

/**
 * On the front page: one quiet entry below "Your rooms" that opens a chooser
 * for sending or getting photos by camera with no room and no network.
 */
export default function NearbyFront({ master }) {
    const input = useRef(null);
    const [choosing, setChoosing] = useState(false);
    const [items, setItems] = useState(null);
    const [receiving, setReceiving] = useState(false);
    const canReceive = !!navigator.mediaDevices?.getUserMedia;

    const picked = (event) => {
        const files = [...(event.target.files || [])];
        event.target.value = '';
        if (!files.length) return;
        setChoosing(false);
        const sendable = itemsOfFiles(files);
        if (sendable.length) setItems(sendable);
        else master.emitter.emit('showError', FILES_TOO_LARGE);
    };

    const startSend = () => {
        setChoosing(false);
        input.current?.click();
    };

    const startReceive = () => {
        setChoosing(false);
        setReceiving(true);
    };

    return (
        <Box sx={{ width: '100%', textAlign: 'center' }}>
            <Button
                size="small"
                color="inherit"
                aria-haspopup={canReceive ? 'dialog' : undefined}
                onClick={() => (canReceive ? setChoosing(true) : input.current?.click())}
                sx={{
                    textTransform: 'none',
                    color: 'text.secondary',
                    fontWeight: 500,
                    fontSize: '0.8125rem',
                    lineHeight: 1.4,
                    whiteSpace: 'normal',
                    textAlign: 'center',
                    maxWidth: '100%',
                    px: 1.25,
                    py: 0.75,
                    '&:hover': {
                        color: 'text.primary',
                        backgroundColor: 'action.hover',
                    },
                }}
            >
                {canReceive ? TRIGGER_LABEL : SEND_ONLY_LABEL}
            </Button>
            {choosing && (
                <Dialog
                    open
                    onClose={() => setChoosing(false)}
                    maxWidth="xs"
                    fullWidth
                    aria-labelledby="nearby-front-title"
                >
                    <DialogTitle id="nearby-front-title" sx={{ pr: 6 }}>
                        {CHOOSER_TITLE}
                    </DialogTitle>
                    <IconButton
                        aria-label="Close"
                        onClick={() => setChoosing(false)}
                        sx={{ position: 'absolute', right: 8, top: 8 }}
                    >
                        <CloseRounded />
                    </IconButton>
                    <DialogContent>
                        <Typography variant="body2" sx={{ color: 'text.secondary', mb: 2 }}>
                            {NO_NETWORK_TEXT}
                        </Typography>
                        <Stack spacing={1.25}>
                            <Button
                                variant="outlined"
                                color="inherit"
                                size="large"
                                fullWidth
                                startIcon={<QrCode2Rounded />}
                                onClick={startSend}
                                sx={{ justifyContent: 'flex-start', textTransform: 'none', color: 'text.primary', py: 1.25 }}
                            >
                                {SEND_MANY_TITLE}
                            </Button>
                            {canReceive && (
                                <Button
                                    variant="outlined"
                                    color="inherit"
                                    size="large"
                                    fullWidth
                                    startIcon={<QrCodeScannerRounded />}
                                    onClick={startReceive}
                                    sx={{ justifyContent: 'flex-start', textTransform: 'none', color: 'text.primary', py: 1.25 }}
                                >
                                    {RECEIVE_TITLE}
                                </Button>
                            )}
                        </Stack>
                    </DialogContent>
                </Dialog>
            )}
            <input ref={input} type="file" accept="image/*,video/*" multiple hidden data-testid="nearby-files"
                data-max-bytes={MAX_LIGHT_BYTES} onChange={picked} />
            {items && <LightSendMany emitter={master.emitter} items={items} onClose={() => setItems(null)} />}
            {receiving && <LightReceive master={master} open onClose={() => setReceiving(false)} />}
        </Box>
    );
}

NearbyFront.propTypes = {
    master: PropTypes.object.isRequired,
};
