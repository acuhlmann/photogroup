import React, { useState, useEffect, useCallback } from 'react';
import PropTypes from 'prop-types';

import Box from '@mui/material/Box';
import Stack from '@mui/material/Stack';
import Button from '@mui/material/Button';
import Typography from '@mui/material/Typography';
import NotificationsActiveRounded from '@mui/icons-material/NotificationsActiveRounded';

import { askToNotify } from './newPhotoNotices';
import { enablePush } from './pushNotices';
import { readPreference, savePreference } from './preferences';

const ASKED = 'photogroup.notifyAsked';

function askedBefore() {
    try {
        return localStorage.getItem(ASKED) === '1';
    } catch {
        return false;
    }
}

function rememberAsk() {
    try {
        localStorage.setItem(ASKED, '1');
    } catch {
        // Storage blocked: it asks again next time, which is the lesser ill.
    }
}

/** The browser has not been asked yet, and this person has never answered. */
function worthAsking(win = window) {
    if (askedBefore()) return false;
    if (readPreference('notify')) return false;
    const api = 'Notification' in win ? win.Notification : null;
    return !!api && api.permission === 'default';
}

/**
 * The offer to be told about new photos, put in front of someone the moment a
 * room opens: the usual plan is to leave for the camera or another app rather
 * than stand and wait, and a permission asked for while the room is on screen
 * is the one chance to be useful. One answer either way, then it is not asked
 * again on this browser. Settings holds the same switch for later thoughts.
 */
export default function NotifyPrompt({ master, win = window }) {
    const [open, setOpen] = useState(false);
    const [busy, setBusy] = useState(false);

    // Wait for the room, because being told about a room needs one to be
    // told about: the subscription is left with the server per room.
    useEffect(() => {
        const show = () => { if (worthAsking(win)) setOpen(true); };
        if (master.me) show();
        else master.emitter.on('addPeerDone', show);
        return () => master.emitter.removeListener('addPeerDone', show);
    }, [master, win]);

    const accept = useCallback(async () => {
        setBusy(true);
        rememberAsk();
        if (await askToNotify(win)) {
            savePreference('notify', true);
            // Push is a bonus: an iPhone in a plain tab, or a server with no
            // keys, keeps the notice for while the page runs in the background.
            enablePush({ service: master.service, win }).catch(() => {});
        }
        setBusy(false);
        setOpen(false);
    }, [master, win]);

    const decline = useCallback(() => {
        rememberAsk();
        setOpen(false);
    }, []);

    if (!open) return null;

    return (
        <Box data-testid="notify-prompt" sx={{
            mb: 2, p: 1.5, borderRadius: 2, border: 1, borderColor: 'divider', bgcolor: 'action.hover',
            maxWidth: 560, mx: 'auto', width: '100%',
        }}>
            <Stack direction="row" spacing={1.25} sx={{ alignItems: 'flex-start' }}>
                <NotificationsActiveRounded aria-hidden="true" sx={{ fontSize: 20, color: 'primary.main', mt: '1px' }} />
                <Box sx={{ minWidth: 0 }}>
                    <Typography variant="subtitle2" sx={{ fontWeight: 600 }}>Tell me when photos arrive</Typography>
                    <Typography variant="body2" sx={{ color: 'text.secondary', lineHeight: 1.5 }}>
                        Go and take the next one. You get a notice when someone adds photos to this room.
                    </Typography>
                    <Stack direction="row" spacing={1} sx={{ mt: 1 }}>
                        <Button size="small" variant="contained" disabled={busy} onClick={accept} sx={{ textTransform: 'none' }}>
                            {busy ? 'Asking the browser…' : 'Tell me'}
                        </Button>
                        <Button size="small" onClick={decline} sx={{ textTransform: 'none' }}>Not now</Button>
                    </Stack>
                </Box>
            </Stack>
        </Box>
    );
}

NotifyPrompt.propTypes = {
    master: PropTypes.object.isRequired,
    win: PropTypes.object,
};
