import React, { useRef, useState } from 'react';
import PropTypes from 'prop-types';
import Box from '@mui/material/Box';
import Button from '@mui/material/Button';
import Stack from '@mui/material/Stack';
import Typography from '@mui/material/Typography';
import QrCode2Rounded from '@mui/icons-material/QrCode2Rounded';
import QrCodeScannerRounded from '@mui/icons-material/QrCodeScannerRounded';
import LightReceive, { RECEIVE_TITLE } from './LightReceive';
import LightSendMany, { SEND_MANY_TITLE, itemsOfFiles } from './LightSendMany';
import { MAX_LIGHT_BYTES } from './lightFrames';

export const NO_NETWORK_TEXT = 'With no network and no room: from one screen to the camera of the other phone.';
export const FILES_TOO_LARGE = 'These files are too large to send by camera.';

/**
 * On the front page: photos from this phone to a phone near it by camera,
 * with no room and no network.
 */
export default function NearbyFront({ master }) {
    const input = useRef(null);
    const [items, setItems] = useState(null);
    const [receiving, setReceiving] = useState(false);
    const canReceive = !!navigator.mediaDevices?.getUserMedia;

    const picked = (event) => {
        const files = [...(event.target.files || [])];
        event.target.value = '';
        if (!files.length) return;
        const sendable = itemsOfFiles(files);
        if (sendable.length) setItems(sendable);
        else master.emitter.emit('showError', FILES_TOO_LARGE);
    };

    return (
        <Box sx={{ width: '100%', pt: 1.5 }}>
            <Stack direction="row" spacing={1} sx={{ justifyContent: 'center', flexWrap: 'wrap', rowGap: 0.5 }}>
                <Button size="small" color="inherit" startIcon={<QrCode2Rounded />} onClick={() => input.current?.click()}
                    sx={{ textTransform: 'none', color: 'text.primary' }}>
                    {SEND_MANY_TITLE}
                </Button>
                {canReceive && (
                    <Button size="small" color="inherit" startIcon={<QrCodeScannerRounded />} onClick={() => setReceiving(true)}
                        sx={{ textTransform: 'none', color: 'text.primary' }}>
                        {RECEIVE_TITLE}
                    </Button>
                )}
            </Stack>
            <Typography variant="caption" sx={{ display: 'block', color: 'text.secondary', textAlign: 'center', mt: 0.25 }}>
                {NO_NETWORK_TEXT}
            </Typography>
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
