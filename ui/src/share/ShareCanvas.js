import React, { useEffect, useRef, useCallback } from 'react';
import Gallery from "./gallery/Gallery";

import Button from '@mui/material/Button';
import IconButton from '@mui/material/IconButton';
import CloseRounded from '@mui/icons-material/CloseRounded';
import Logger from 'js-logger';
import { withSnackbar } from './compatibility/withSnackbar';

import FrontView from "./FrontView";
import MeView from "./MeView";
import TopologyView from './topology/TopologyView';
import WebTorrent from 'webtorrent';
// import Online from 'online-js' // Commented out - not currently used and causes axios import issues

function ShareCanvas({master, enqueueSnackbar, closeSnackbar}) {
    const deferredPromptRef = useRef(null);

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

        master.emitter.on('showError', handleShowError);

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

        return () => {
            master.emitter.removeListener('showError', handleShowError);
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

    const askForPush = useCallback(() => {
        snack(
            <div>
                <Button style={{color: 'white'}} onClick={subscribeToPush}>
                    Subscribe to Notifications?
                </Button>
            </div>
        );
    }, [snack, subscribeToPush]);

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

    return (
        <div>
            <TopologyView master={master} />
            <MeView master={master} />
            <FrontView master={master}/>
            <Gallery master={master} />
        </div>
    );
}

export default withSnackbar(ShareCanvas);