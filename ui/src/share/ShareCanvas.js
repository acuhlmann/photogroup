import React, { useEffect, useRef, useCallback } from 'react';
import Gallery from "./gallery/Gallery";

import Button from '@mui/material/Button';
import {withStyles, withTheme } from '@mui/styles';

import Logger from 'js-logger';
import { withSnackbar } from './compatibility/withSnackbar';

import FrontView from "./FrontView";
import MeView from "./MeView";
import TopologyView from './topology/TopologyView';
import WebTorrent from 'webtorrent';
// import Online from 'online-js' // Commented out - not currently used and causes axios import issues

const styles = theme => ({
    heading: {
        fontSize: theme.typography.pxToRem(15),
        fontWeight: theme.typography.fontWeightRegular,
    },
    content: {
        padding: '0px 0px 0px 0px',
        width: '100%',
        overflow: 'hidden'
    },
    nooverflow: {
        overflow: 'hidden',
        width: '100%'
    },

    white: {
        color: '#ffffff'
    },
});

function ShareCanvas({master, classes, enqueueSnackbar, closeSnackbar, theme}) {
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
                <Button 
                    className={classes.white} 
                    onClick={() => closeSnackbar(key)} 
                    size="small"
                >
                    x
                </Button>
            ),
            anchorOrigin: {
                vertical: vertical,
                horizontal: 'right'
            }
        });
    }, [enqueueSnackbar, closeSnackbar, classes.white]);

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

export default withTheme(withSnackbar(withStyles(styles)(ShareCanvas)));