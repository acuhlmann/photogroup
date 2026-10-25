import React, { useState, useEffect, useRef, useCallback } from 'react';
import Gallery from "./gallery/Gallery";

import Button from '@mui/material/Button';
import IconButton from '@mui/material/IconButton';
import CloseRounded from '@mui/icons-material/CloseRounded';
import Box from '@mui/material/Box';
import useMediaQuery from '@mui/material/useMediaQuery';
import { useTheme } from '@mui/material/styles';
import Logger from 'js-logger';
import { withSnackbar } from './compatibility/withSnackbar';

import FrontView from "./FrontView";
import GeekStage from "./geek/GeekStage";
import SimpleFront from "./simple/SimpleFront";
import SimpleRoomBar from "./simple/SimpleRoomBar";
import WebTorrent from 'webtorrent';
import { takeRoomNotice } from "./roomNotice";

const BACKUP_SNACK = 'serverCopyBackup';

/**
 * Show the landing page or room gallery for the chosen mode. The gallery
 * keeps the same place in the tree in every mode, so switching modes in a
 * room doesn't remount it and lose the photos it has loaded.
 */
function ShareCanvas({master, mode = 'default', roomName = '', enqueueSnackbar, closeSnackbar}) {
    const simple = mode === 'simple';
    // Only geek mode shows how people connect; default is photos alone.
    const geek = mode === 'geek';
    const deferredPromptRef = useRef(null);
    const theme = useTheme();
    const isMobile = useMediaQuery(theme.breakpoints.down('md'));

    const [hasRoom, setHasRoom] = useState(false);
    const [tiles, setTiles] = useState([]);

    useEffect(() => {
        const notice = takeRoomNotice();
        if (notice) enqueueSnackbar(notice, { variant: 'info', autoHideDuration: 8000 });

        if(!WebTorrent.WEBRTC_SUPPORT) {
            const msg = 'Your browser does not support WebRTC';
            Logger.error(msg);
            enqueueSnackbar(msg, {
                variant: 'error'
            });
        }

        // Listen for error events to show user feedback
        const handleShowError = (message) => {
            enqueueSnackbar(message, {
                variant: 'error',
                autoHideDuration: 6000
            });
        };

        const handleShowInfo = (message) => {
            enqueueSnackbar(message, {
                variant: 'info',
                autoHideDuration: 8000
            });
        };

        // Our server copies: keep the page open until they land, then say so.
        const handleBackup = ({ pending, safe }) => {
            if (pending > 0) {
                enqueueSnackbar('Uploading a server copy · keep PhotoGroup open until it is done', {
                    key: BACKUP_SNACK, variant: 'info', persist: true, preventDuplicate: true
                });
                return;
            }
            closeSnackbar(BACKUP_SNACK);
            if (safe) {
                enqueueSnackbar('The server copy is uploaded · you can lock your phone', {
                    variant: 'success', autoHideDuration: 6000
                });
            }
        };

        const handleReadyToUpload = () => {
            setHasRoom(true);
        };

        master.emitter.on('showError', handleShowError);
        master.emitter.on('showInfo', handleShowInfo);
        master.emitter.on('readyToUpload', handleReadyToUpload);
        master.emitter.on('serverCopyBackup', handleBackup);

        const handleBeforeInstallPrompt = (e) => {
            console.info('beforeinstallprompt');
            deferredPromptRef.current = e;
            askForInstall();
        };

        const handleAppInstalled = (e) => {
            console.info('appinstalled');
        };

        window.addEventListener('beforeinstallprompt', handleBeforeInstallPrompt);
        window.addEventListener('appinstalled', handleAppInstalled);

        if(window.matchMedia('(display-mode: standalone)').matches) {
            console.log('matches display-mode:standalone PWA');
        }

        // Check if we already have a room in URL
        const urlParams = new URLSearchParams(window.location.search);
        if (urlParams.has('room')) {
            setHasRoom(true);
        }

        return () => {
            master.emitter.removeListener('showError', handleShowError);
            master.emitter.removeListener('showInfo', handleShowInfo);
            master.emitter.removeListener('readyToUpload', handleReadyToUpload);
            master.emitter.removeListener('serverCopyBackup', handleBackup);
            window.removeEventListener('beforeinstallprompt', handleBeforeInstallPrompt);
            window.removeEventListener('appinstalled', handleAppInstalled);
        };
    }, [master.emitter, enqueueSnackbar, closeSnackbar]);

    const snack = useCallback((payload, type = 'info', persist = false, vertical = 'bottom') => {
        enqueueSnackbar(payload, {
            variant: type,
            persist: persist,
            autoHideDuration: 4000,
            action: (key) => (
                <IconButton
                    size="small"
                    aria-label="Dismiss notification"
                    onClick={() => closeSnackbar(key)}
                    sx={{ color: 'inherit' }}
                >
                    <CloseRounded fontSize="small" />
                </IconButton>
            ),
            anchorOrigin: {
                vertical: vertical,
                horizontal: 'right'
            }
        });
    }, [enqueueSnackbar, closeSnackbar]);

    const install = useCallback(() => {
        if (deferredPromptRef.current) {
            deferredPromptRef.current.prompt();
            deferredPromptRef.current.userChoice.then((choiceResult) => {
                if(choiceResult.outcome === 'accepted') {
                    console.log('User accepted the A2H2 prompt');
                } else {
                    console.log('User dismissed the A2HS prompt');
                }
                deferredPromptRef.current = null;
            });
        }
    }, []);

    const askForInstall = useCallback(() => {
        snack(
            <div>
                <Button style={{color: 'white'}} onClick={install}>
                    Install App?
                </Button>
            </div>,
            'info',
            true
        );
    }, [snack, install]);

    // Room. Simple puts its bar above big photo squares, default is the
    // gallery alone. Geek is the network map alone, with the photos drawn on
    // it; the gallery stays mounted but hidden so it keeps loading them and
    // can still open the viewer.
    if (hasRoom) {
        return (
            <Box sx={{
                flex: 1,
                minHeight: 0,
                display: 'flex',
                overflow: 'hidden',
                position: 'relative',
            }}>
                {geek ? <GeekStage master={master} tiles={tiles} isMobile={isMobile} /> : null}
                <Box sx={{
                    display: geek ? 'none' : 'block',
                    flex: 1,
                    minWidth: 0,
                    overflow: 'auto',
                    px: { xs: 1.5, sm: 2 },
                    pt: { xs: 1.5, sm: 2 },
                    pb: 2,
                }}>
                    {simple ? <SimpleRoomBar master={master} roomName={roomName} /> : null}
                    <Gallery master={master} variant={simple ? 'simple' : 'full'}
                        showNetworkReadout={false} onTilesChange={setTiles} />
                </Box>
            </Box>
        );
    }

    // No room: show FrontView landing
    return (
        <Box sx={{
            flex: 1,
            overflow: 'auto',
            minHeight: 0,
            px: { xs: 1.5, sm: 2 },
            py: { xs: 1.5, sm: 2 },
        }}>
            {simple ? <SimpleFront master={master}/> : <FrontView master={master}/>}
        </Box>
    );
}

export default withSnackbar(ShareCanvas);
