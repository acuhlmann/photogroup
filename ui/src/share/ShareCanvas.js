import React, { useState, useEffect, useRef, useCallback } from 'react';
import Gallery from "./gallery/Gallery";

import Button from '@mui/material/Button';
import IconButton from '@mui/material/IconButton';
import CloseRounded from '@mui/icons-material/CloseRounded';
import ChevronRightRounded from '@mui/icons-material/ChevronRightRounded';
import HubRounded from '@mui/icons-material/HubRounded';
import Box from '@mui/material/Box';
import Drawer from '@mui/material/Drawer';
import Typography from '@mui/material/Typography';
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

    const [hasRoom, setHasRoom] = useState(false);
    const [wtNumPeers, setWtNumPeers] = useState(0);
    const [peopleOpen, setPeopleOpen] = useState(() => {
        if (typeof window === 'undefined') return true;
        return window.matchMedia('(min-width: 900px)').matches;
    });

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

    const connectionPanel = (
        <Box sx={{ display: 'flex', flexDirection: 'column', height: '100%', minHeight: 0 }}>
            <Box sx={{
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'space-between',
                px: 2,
                py: 1.25,
                borderBottom: 1,
                borderColor: 'divider',
            }}>
                <Box>
                    <Typography className="tech-text" sx={{ color: 'primary.main', lineHeight: 1.2 }}>
                        Link
                    </Typography>
                    <Typography variant="subtitle2" sx={{ mt: 0.25 }}>How you connect</Typography>
                </Box>
                <IconButton
                    size="small"
                    aria-label="Hide connection map"
                    onClick={() => setPeopleOpen(false)}
                >
                    <ChevronRightRounded fontSize="small" />
                </IconButton>
            </Box>
            <Box sx={{ flex: 1, minHeight: 0 }}>
                <NetworkPanel
                    master={master}
                    isMobile={isMobile}
                    isCenter
                    wtNumPeers={wtNumPeers}
                />
            </Box>
        </Box>
    );

    // Room: photos fill the page. The peer map sits beside them, or in a sheet on a phone.
    if (hasRoom) {
        return (
            <Box sx={{
                flex: 1,
                minHeight: 0,
                display: 'flex',
                overflow: 'hidden',
                position: 'relative',
            }}>
                <Box sx={{
                    flex: 1,
                    minWidth: 0,
                    overflow: 'auto',
                    px: { xs: 1.5, sm: 2 },
                    pt: { xs: 1.5, sm: 2 },
                    pb: isMobile ? 10 : 2,
                }}>
                    <Gallery master={master} />
                </Box>

                {!isMobile && peopleOpen && (
                    <Box sx={{
                        width: 360,
                        flexShrink: 0,
                        display: 'flex',
                        flexDirection: 'column',
                        minHeight: 0,
                        borderLeft: 1,
                        borderColor: 'divider',
                        bgcolor: 'transparent',
                        background: 'color-mix(in srgb, var(--paper) 86%, transparent)',
                        backdropFilter: 'blur(16px)',
                    }}>
                        {connectionPanel}
                    </Box>
                )}

                {!isMobile && !peopleOpen && (
                    <Box sx={{
                        width: 48,
                        flexShrink: 0,
                        display: 'flex',
                        alignItems: 'flex-start',
                        justifyContent: 'center',
                        pt: 1,
                        borderLeft: 1,
                        borderColor: 'divider',
                    }}>
                        <IconButton
                            aria-label="Show how people connect"
                            onClick={() => setPeopleOpen(true)}
                        >
                            <HubRounded />
                        </IconButton>
                    </Box>
                )}

                {isMobile && (
                    <>
                        <Button
                            variant="contained"
                            color="primary"
                            startIcon={<HubRounded />}
                            aria-label="Show how people connect"
                            onClick={() => setPeopleOpen(true)}
                            sx={{
                                position: 'fixed',
                                bottom: 16,
                                right: 16,
                                zIndex: 10,
                            }}
                        >
                            People
                        </Button>
                        <Drawer
                            anchor="bottom"
                            open={peopleOpen}
                            onClose={() => setPeopleOpen(false)}
                            slotProps={{
                                paper: {
                                    sx: {
                                        height: '72vh',
                                        borderTopLeftRadius: 16,
                                        borderTopRightRadius: 16,
                                        bgcolor: 'background.default',
                                    },
                                },
                            }}
                        >
                            {connectionPanel}
                        </Drawer>
                    </>
                )}
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
            <FrontView master={master}/>
        </Box>
    );
}

export default withSnackbar(ShareCanvas);
