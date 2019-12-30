import React, { Component } from 'react';
import PropTypes from 'prop-types';
import Gallery from "./gallery/Gallery";

import Button from '@material-ui/core/Button';

import {withStyles, createMuiTheme } from '@material-ui/core/styles';
import { ThemeProvider } from '@material-ui/styles';

import Logger from 'js-logger';
import ExpansionPanel from '@material-ui/core/ExpansionPanel';
import ExpansionPanelSummary from '@material-ui/core/ExpansionPanelSummary';
import ExpansionPanelDetails from '@material-ui/core/ExpansionPanelDetails';
import Typography from '@material-ui/core/Typography';
import ExpandMoreIcon from '@material-ui/icons/ExpandMore';
import { withSnackbar } from 'notistack';

import TopologyView from './topology/TopologyView';

import OtherPeersView from "./OtherPeersView";
import QRCodeView from "./security/QRCodeView";
import MeView from "./MeView";
import WebTorrent from 'webtorrent';
import update from 'immutability-helper';
import Online from 'online-js'

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

        const {enqueueSnackbar, master, gallery} = props;

        this.master = master;
        const {emitter} = master;
        this.gallery = gallery;

        this.state = {
            loader: {},
            expandedGallery: true,
            expandedInfo: true,
        };

        if(!WebTorrent.WEBRTC_SUPPORT) {
            const msg = 'Your browser does not support WebRTC';
            Logger.error(msg);
            enqueueSnackbar(msg, {
                variant: 'error'
            });
        }

        this.checkOnline();

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

        const statusChecker = Online();

        const onlineCallback = (status) => {
            if (status === true) {
                Logger.info('Connected!')
                //this.snack('Connected', 'warn', false, 'top');
            } else {
                Logger.warn('Disconnected!')
                this.snack('Disconnected', 'warning', false, 'top');
            }
        }
        statusChecker.onUpdateStatus(onlineCallback)

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

    handleExpand = panel => (event, expanded) => {

        this.setState({
            [panel]: expanded,
        });
    };

    render() {

        const defaultTheme = createMuiTheme();

        const { classes, master } = this.props;

        return (
            <ThemeProvider theme={defaultTheme}>

                {<QRCodeView master={master}/>}
                <TopologyView master={master} />
                <MeView master={master} />
                <Gallery className={classes.nooverflow} model={this.gallery} master={master} />
                <OtherPeersView master={master} />

            </ThemeProvider>
        );
    }
}

ShareCanvas.propTypes = {
    classes: PropTypes.object.isRequired,
    gallery: PropTypes.object.isRequired,
};

export default withSnackbar(withStyles(styles)(ShareCanvas));