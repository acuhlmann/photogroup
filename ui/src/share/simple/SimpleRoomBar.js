import React, { useState, useEffect, useCallback } from 'react';
import PropTypes from 'prop-types';
import Box from '@mui/material/Box';
import Stack from '@mui/material/Stack';
import Button from '@mui/material/Button';
import Typography from '@mui/material/Typography';
import Collapse from '@mui/material/Collapse';
import AddAPhotoRounded from '@mui/icons-material/AddAPhotoRounded';
import QrCode2Rounded from '@mui/icons-material/QrCode2Rounded';
import ShareRounded from '@mui/icons-material/ShareRounded';
import { QRCodeSVG } from 'qrcode.react';
import copy from 'clipboard-copy';
import Logger from 'js-logger';

function peopleLabel(count) {
    if (count <= 1) return 'Just you so far';
    return `${count} people here`;
}

/**
 * The top of a room in simple mode: the code others scan to join, how many
 * are here, and one big button to add photos (it opens the header's file input).
 */
function SimpleRoomBar({ master }) {
    const [count, setCount] = useState(() => master.peers?.items?.length || 1);
    const [showCode, setShowCode] = useState(false);
    const [copied, setCopied] = useState(false);
    const url = window.location.origin + '?room=' + master.service.id;
    const alone = count <= 1;

    useEffect(() => {
        const handleCount = numPeers => setCount(numPeers);
        master.emitter.on('numPeersChange', handleCount);
        return () => master.emitter.removeListener('numPeersChange', handleCount);
    }, [master.emitter]);

    const sendLink = useCallback(async () => {
        const data = { title: 'PhotoGroup', text: 'Get the photos', url };
        try {
            if (navigator.share && (!navigator.canShare || navigator.canShare(data))) {
                await navigator.share(data);
                return;
            }
            await copy(url);
            setCopied(true);
            setTimeout(() => setCopied(false), 3000);
        } catch (err) {
            if (err && err.name === 'AbortError') return;
            Logger.warn('Sending the room link failed: ' + (err && err.message ? err.message : err));
        }
    }, [url]);

    return (
        <Stack spacing={2} sx={{ mb: 3, maxWidth: 560, mx: 'auto', width: '100%' }}>
            <Collapse in={alone || showCode}>
                <Stack spacing={1.5} sx={{
                    alignItems: 'center',
                    textAlign: 'center',
                    p: 2.5,
                    borderRadius: 3,
                    border: 1,
                    borderColor: 'divider',
                    bgcolor: 'background.paper',
                }}>
                    <Typography variant="h6" component="h2" sx={{ fontWeight: 700 }}>
                        Let the people next to you scan this
                    </Typography>
                    <Box sx={{ bgcolor: '#fff', p: 2, borderRadius: 2, lineHeight: 0 }}>
                        <QRCodeSVG value={url} size={220} bgColor="#ffffff" fgColor="#000000" />
                    </Box>
                    <Typography variant="body2" sx={{ color: 'text.secondary' }}>
                        They point their camera at it and open the link. Nothing to install.
                    </Typography>
                    <Button size="small" startIcon={<ShareRounded />} onClick={sendLink} sx={{ textTransform: 'none' }}>
                        {copied ? 'Link copied' : 'Send the link instead'}
                    </Button>
                </Stack>
            </Collapse>

            <Stack direction="row" spacing={1} sx={{ alignItems: 'center' }}>
                <Typography variant="body1" role="status" sx={{ flex: 1, fontWeight: 600 }}>
                    {peopleLabel(count)}
                </Typography>
                {!alone && (
                    <Button variant="outlined" color="inherit" startIcon={<QrCode2Rounded />}
                        onClick={() => setShowCode(value => !value)} sx={{ textTransform: 'none' }}>
                        {showCode ? 'Hide code' : 'Add people'}
                    </Button>
                )}
                <Button color="inherit" onClick={() => master.leaveRoomAndReload()}
                    sx={{ textTransform: 'none', color: 'text.secondary' }}>
                    Leave
                </Button>
            </Stack>

            <Button
                component="label"
                htmlFor="contained-button-file"
                variant="contained"
                size="large"
                startIcon={<AddAPhotoRounded />}
                sx={{ py: 2, fontSize: '1.2rem', fontWeight: 700, textTransform: 'none', borderRadius: 3 }}
            >
                Share a photo
            </Button>
        </Stack>
    );
}

SimpleRoomBar.propTypes = {
    master: PropTypes.object.isRequired,
};

export default SimpleRoomBar;
