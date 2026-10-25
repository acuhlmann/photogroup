import React, { useState, useCallback } from 'react';
import PropTypes from 'prop-types';
import Box from '@mui/material/Box';
import Stack from '@mui/material/Stack';
import Button from '@mui/material/Button';
import Typography from '@mui/material/Typography';
import ShareRounded from '@mui/icons-material/ShareRounded';
import { QRCodeSVG } from 'qrcode.react';
import copy from 'clipboard-copy';
import Logger from 'js-logger';

export function roomUrl(id) {
    return window.location.origin + '?room=' + encodeURIComponent(id);
}

/**
 * The one way to invite people, in every mode: a code to scan, and the
 * link to send when they aren't next to you.
 */
export default function InviteCode({ master, roomName = '', size = 220 }) {
    const [copied, setCopied] = useState(false);
    const url = roomUrl(master.service.id);

    const sendLink = useCallback(async () => {
        const data = { title: roomName || 'PhotoGroup', text: roomName ? `Get the photos of ${roomName}` : 'Get the photos', url };
        if (navigator.share && (!navigator.canShare || navigator.canShare(data))) {
            try {
                await navigator.share(data);
                return;
            } catch (err) {
                if (err && err.name === 'AbortError') return;
                // The share sheet failed; copying the link still works.
                Logger.warn('Sharing the room link failed: ' + (err && err.message ? err.message : err));
            }
        }
        try {
            await copy(url);
            setCopied(true);
            setTimeout(() => setCopied(false), 3000);
        } catch (err) {
            Logger.warn('Copying the room link failed: ' + (err && err.message ? err.message : err));
            master.emitter.emit('showError', "Couldn't send the link. Let them scan the code instead.");
        }
    }, [url, roomName, master.emitter]);

    return (
        <Stack spacing={1.5} sx={{ alignItems: 'center', textAlign: 'center' }}>
            <Box sx={{ bgcolor: '#fff', p: 2, borderRadius: 2, lineHeight: 0 }}>
                <QRCodeSVG value={url} size={size} bgColor="#ffffff" fgColor="#000000" />
            </Box>
            <Typography variant="body2" sx={{ color: 'text.secondary' }}>
                They point their camera at it and open the link. Nothing to install.
            </Typography>
            <Button size="small" startIcon={<ShareRounded />} onClick={sendLink} sx={{ textTransform: 'none' }}>
                {copied ? 'Link copied' : 'Send the link instead'}
            </Button>
        </Stack>
    );
}

InviteCode.propTypes = {
    master: PropTypes.object.isRequired,
    roomName: PropTypes.string,
    size: PropTypes.number,
};
