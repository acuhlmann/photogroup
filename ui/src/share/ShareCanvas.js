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
import NetworkPanel from "./NetworkPanel";
import WebTorrent from 'webtorrent';

function ShareCanvas({master, enqueueSnackbar, closeSnackbar}) {
    const deferredPromptRef = useRef(null);
    const theme = useTheme();
    const isMobile = useMediaQuery(theme.breakpoints.down('md'));
    const isDesktop = useMediaQuery(theme.breakpoints.up('lg'));

    const [hasRoom, setHasRoom] = useState(false);
    const [wtNumPeers, setWtNumPeers] = useState(0);

    useEffect(() => {
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

        const handleReadyToUpload = () => {
            setHasRoom(true);
        };

        const handleWire = (wire, addr, torrent) => {
            setWtNumPeers(torrent.numPeers);
        };

        master.emitter.on('showError', handleShowError);
        master.emitter.on('readyToUpload', handleReadyToUpload);
        master.emitter.on('wire', handleWire);

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
            master.emitter.removeListener('readyToUpload', handleReadyToUpload);
            master.emitter.removeListener('wire', handleWire);
            window.removeEventListener('beforeinstallprompt', handleBeforeInstallPrompt);
            window.removeEventListener('appinstalled', handleAppInstalled);
        };
    }, [master.emitter, enqueueSnackbar]);

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

    const subscribeToPush = useCallback(() => {
        Notification.requestPermission(status => {
            console.info('Notification.status' + status);
        });
    }, []);

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

    // When room is active and on desktop: split-pane layout
    if (hasRoom && !isMobile) {
        return (
            <Box sx={{
                display: 'grid',
                gridTemplateColumns: isDesktop ? '380px 1fr' : '320px 1fr',
                height: 'calc(100vh - 56px)',
                overflow: 'hidden',
            }}>
                {/* Left: Network Panel */}
                <Box sx={{
                    overflow: 'auto',
                    borderRight: `1px solid ${theme.palette.divider}`,
                }}>
                    <NetworkPanel
                        master={master}
                        isMobile={false}
                        wtNumPeers={wtNumPeers}
                    />
                </Box>

                {/* Right: Gallery + FrontView */}
                <Box sx={{
                    overflow: 'auto',
                    p: { sm: 2, lg: 3 },
                }}>
                    <FrontView master={master}/>
                    <Gallery master={master} />
                </Box>
            </Box>
        );
    }

    // Mobile / no room: stacked layout
    return (
        <Box sx={{
            minHeight: 'calc(100vh - 48px)',
            px: { xs: 1.5, sm: 2 },
            py: { xs: 1.5, sm: 2 },
        }}>
            <FrontView master={master}/>
            <Gallery master={master} />
            {/* Mobile FAB for network panel */}
            {hasRoom && (
                <NetworkPanel
                    master={master}
                    isMobile={true}
                    wtNumPeers={wtNumPeers}
                />
            )}
        </Box>
    );
}

export default withSnackbar(ShareCanvas);
