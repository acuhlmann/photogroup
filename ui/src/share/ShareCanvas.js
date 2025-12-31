import React, { Component } from 'react';
import Gallery from "./gallery/Gallery";

import Button from '@material-ui/core/Button';
import {withStyles, withTheme } from '@material-ui/core/styles';

import Logger from 'js-logger';
import { withSnackbar } from 'notistack';

import FrontView from "./FrontView";
import MeView from "./MeView";
import TopologyView from './topology/TopologyView';
import WebTorrent from 'webtorrent';
// import Online from 'online-js' // Commented out - not currently used and causes axios import issues

const styles = theme => ({
    typography: {
        useNextVariants: true,
    },
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

class ShareCanvas extends Component {

    constructor(props) {
        super(props);

        const {enqueueSnackbar} = props;

        if(!WebTorrent.WEBRTC_SUPPORT) {
            const msg = 'Your browser does not support WebRTC';
            Logger.error(msg);
            enqueueSnackbar(msg, {
                variant: 'error'
            });
        }

        // Listen for error events to show user feedback
        props.master.emitter.on('showError', (message) => {
            enqueueSnackbar(message, {
                variant: 'error',
                autoHideDuration: 6000
            });
        });

        //this.checkOnline();

        window.addEventListener('beforeinstallprompt', e => {
            console.info('beforeinstallprompt');
            this.deferredPrompt = e;
            this.askForInstall();
        });

        window.addEventListener('appinstalled', e => {
            console.info('appinstalled');
        });

        if(window.matchMedia('(display-mode: standalone)').matches) {
            console.log('matches display-mode:standalone PWA');
        }

        /*if('Notification' in window && navigator.serviceWorker) {
            console.info('Notification.permission ' + Notification.permission);
            if(Notification.permission === 'granted') {

            } else if(Notification.permission === 'blocked') {

                this.askForPush();
            } else {

                this.askForPush();
            }
        }*/
    }

    checkOnline() {
        // Online import is commented out due to axios compatibility issues
        // const statusChecker = Online();
        // const onlineCallback = (status) => {
        //     if (status === true) {
        //         Logger.info('Connected!')
        //         //this.snack('Connected', 'warn', false, 'top');
        //     } else {
        //         Logger.warn('Disconnected!')
        //         this.snack('Disconnected', 'warning', false, 'top');
        //     }
        // };
        // statusChecker.onUpdateStatus(onlineCallback);

        window.addEventListener('load', () => {
            const online = navigator.onLine;
            Logger.info('online ' + online);
            function updateOnlineStatus(event) {
                const online = navigator.onLine;
                Logger.info('online ' + online);
            }
            window.addEventListener('online', updateOnlineStatus);
            window.addEventListener('offline', updateOnlineStatus);
        });
        const online = navigator.onLine;
        Logger.info('online ' + online);
    }

    displayNotification(payload) {
        if('Notification' in window && navigator.serviceWorker) {
            if(Notification.permission === 'granted') {
                navigator.serviceWorker.getRegistration().then(req => {
                    if(req) {
                        req.showNotification(payload);
                    } else {
                        console.error('Cannot find req for Notification');
                    }
                });
            }
        }
    }

    askForPush() {

        this.snack(<div>
            <Button style={{color: 'white'}} onClick={ () => this.subscribeToPush() }>Subscribe to Notifications?</Button>
        </div>);
    }

    subscribeToPush() {
        Notification.requestPermission(status => {
            console.info('Notification.status' + status);
        });
    }

    askForInstall() {

        this.snack(<div>
            <Button style={{color: 'white'}} onClick={ () => this.install() }>Install App?</Button>
        </div>, 'info', true);
    }

    install() {
        this.deferredPrompt.prompt();
        this.deferredPrompt.userChoice.then((choiceResult) => {
            if(choiceResult.outcome === 'accepted') {
                console.log('User accepted the A2H2 prompt');
            } else {
                console.log('User dismissed the A2HS prompt');
            }
            this.deferredPrompt = null;
        });
    }

    snack(payload, type = 'info', persist = false, vertical = 'bottom') {

        const {enqueueSnackbar, closeSnackbar} = this.props;

        enqueueSnackbar(payload, {
            variant: type,
            persist: persist,
            autoHideDuration: 4000,
            action: (key) => (<Button className={this.props.classes.white} onClick={ () => closeSnackbar(key) } size="small">x</Button>),
            anchorOrigin: {
                vertical: vertical,
                horizontal: 'right'
            }
        });
    }

    render() {

        const { master } = this.props;

        return (
            <div>
                <TopologyView master={master} />
                <MeView master={master} />
                <FrontView master={master}/>
                <Gallery master={master} />
            </div>
        );
    }
}

export default withTheme(withSnackbar(withStyles(styles)(ShareCanvas)));