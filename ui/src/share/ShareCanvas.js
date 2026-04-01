import React, { useState, useEffect, useRef, useCallback } from 'react';
import Gallery from "./gallery/Gallery";

import Button from '@mui/material/Button';
import IconButton from '@mui/material/IconButton';
import CloseRounded from '@mui/icons-material/CloseRounded';
import CollectionsRounded from '@mui/icons-material/CollectionsRounded';
import Box from '@mui/material/Box';
import Badge from '@mui/material/Badge';
import Fab from '@mui/material/Fab';
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
    const isDesktop = useMediaQuery(theme.breakpoints.up('lg'));

    const [hasRoom, setHasRoom] = useState(false);
    const [wtNumPeers, setWtNumPeers] = useState(0);
    const [galleryOpen, setGalleryOpen] = useState(false);
    const [photoCount, setPhotoCount] = useState(0);

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

        const handlePhotos = (data) => {
            if (data.type === 'add') {
                setPhotoCount(prev => prev + (Array.isArray(data.item) ? data.item.length : 1));
            } else if (data.type === 'delete') {
                setPhotoCount(prev => Math.max(0, prev - 1));
            }
        };

        master.emitter.on('showError', handleShowError);
        master.emitter.on('readyToUpload', handleReadyToUpload);
        master.emitter.on('wire', handleWire);
        master.emitter.on('photos', handlePhotos);

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
            master.emitter.removeListener('photos', handlePhotos);
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

    // Gallery drawer width
    const galleryDrawerWidth = isDesktop ? 480 : 380;

    // When room is active: network-centric layout with gallery drawer
    if (hasRoom) {
        return (
            <Box sx={{
                display: 'flex',
                flexDirection: 'column',
                height: 'calc(100vh - 56px)',
                overflow: 'hidden',
                position: 'relative',
            }}>
                {/* Main content: Network map takes center stage */}
                <Box sx={{
                    flex: 1,
                    display: 'flex',
                    flexDirection: 'column',
                    overflow: 'hidden',
                }}>
                    <NetworkPanel
                        master={master}
                        isMobile={false}
                        isCenter={true}
                        wtNumPeers={wtNumPeers}
                    />
                </Box>

                {/* Gallery FAB */}
                <Fab
                    size="medium"
                    color="primary"
                    onClick={() => setGalleryOpen(true)}
                    sx={{
                        position: 'fixed',
                        bottom: 20,
                        right: 20,
                        zIndex: 1050,
                        boxShadow: theme.palette.mode === 'dark'
                            ? '0 0 24px rgba(0,229,255,0.3)'
                            : '0 4px 12px rgba(0,0,0,0.15)',
                    }}
                >
                    <Badge badgeContent={photoCount} color="secondary" overlap="circular">
                        <CollectionsRounded />
                    </Badge>
                </Fab>

                {/* Gallery drawer - slides in from right */}
                <Drawer
                    anchor={isMobile ? "bottom" : "right"}
                    open={galleryOpen}
                    onClose={() => setGalleryOpen(false)}
                    PaperProps={{
                        sx: {
                            width: isMobile ? '100%' : galleryDrawerWidth,
                            height: isMobile ? '85vh' : '100%',
                            borderTopLeftRadius: isMobile ? 16 : 0,
                            borderTopRightRadius: isMobile ? 16 : 0,
                            bgcolor: 'background.default',
                        },
                    }}
                >
                    {/* Drawer header */}
                    <Box sx={{
                        display: 'flex',
                        alignItems: 'center',
                        justifyContent: 'space-between',
                        px: 2,
                        py: 1.5,
                        borderBottom: `1px solid ${theme.palette.divider}`,
                        bgcolor: 'background.paper',
                    }}>
                        {isMobile && (
                            <Box sx={{
                                position: 'absolute',
                                top: 8,
                                left: '50%',
                                transform: 'translateX(-50%)',
                                width: 40,
                                height: 4,
                                borderRadius: 2,
                                bgcolor: 'divider',
                            }} />
                        )}
                        <Typography
                            variant="subtitle2"
                            sx={{
                                fontFamily: 'var(--font-mono)',
                                textTransform: 'uppercase',
                                letterSpacing: '0.1em',
                                fontSize: '0.75rem',
                                color: 'text.secondary',
                                mt: isMobile ? 1.5 : 0,
                            }}
                        >
                            Received Photos
                        </Typography>
                        <IconButton size="small" onClick={() => setGalleryOpen(false)}>
                            <CloseRounded fontSize="small" />
                        </IconButton>
                    </Box>

                    {/* Gallery content */}
                    <Box sx={{
                        overflow: 'auto',
                        flex: 1,
                        p: 2,
                    }}>
                        <Gallery master={master} />
                    </Box>
                </Drawer>
            </Box>
        );
    }

    // No room: show FrontView landing
    return (
        <Box sx={{
            minHeight: 'calc(100vh - 48px)',
            px: { xs: 1.5, sm: 2 },
            py: { xs: 1.5, sm: 2 },
        }}>
            <FrontView master={master}/>
        </Box>
    );
}

export default withSnackbar(ShareCanvas);
