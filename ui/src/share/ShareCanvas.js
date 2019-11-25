import React, { Component } from 'react';
import PropTypes from 'prop-types';
import Gallery from "./gallery/Gallery";

import Button from '@material-ui/core/Button';

import {withStyles, createMuiTheme } from '@material-ui/core/styles';
import { ThemeProvider } from '@material-ui/styles';

import Graph from 'vis-react';
import Logger from 'js-logger';
import ExpansionPanel from '@material-ui/core/ExpansionPanel';
import ExpansionPanelSummary from '@material-ui/core/ExpansionPanelSummary';
import ExpansionPanelDetails from '@material-ui/core/ExpansionPanelDetails';
import Typography from '@material-ui/core/Typography';
import ExpandMoreIcon from '@material-ui/icons/ExpandMore';
import { withSnackbar } from 'notistack';
import TopologyHelper from './topology/TopologyHelper';
import OtherPeersView from "./OtherPeersView";
import QRCodeView from "./security/QRCodeView";
import MeView from "./MeView";
import WebTorrent from 'webtorrent';

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
    wordwrap: {
        wordWrap: 'break-word'
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

        const self = this;
        this.master = props.master;
        const {emitter} = props.master;
        this.gallery = props.gallery;

        this.topology = new TopologyHelper(this, emitter, props.master);

        /*let progressRunner;
        emitter.on('wtInitialized', client => {
            progressRunner = setInterval(() => {

                this.setState({
                    loader: {
                        progress: client.progress.toFixed(1) * 100,
                        ratio: client.ratio,
                        downloadSpeed: (client.downloadSpeed / 1024).toFixed(1) + 'kb/s',
                        uploadSpeed: (client.uploadSpeed / 1024).toFixed(1) + 'kb/s'
                    }
                })

            }, 1000);
        });*/

        emitter.on('urls', urls => {

            this.setState({
                urls: urls
            });
        });

        emitter.on('appEvent', event => {

            let msg = '';
            let action = '';
            let peer;

            if(event.type === 'peerConnect' || event.type === 'peerDisconnect') {

                return;
                if(!props.master.client) return;
                if(event.event.peerId === props.master.client.peerId) return;
                action = event.type === 'peerConnect' ? 'connected' : 'disconnected';
                msg = 'Peer ' + action + ': ' + event.event.originPlatform + ' ' + event.event.hostname

            } else if(event.type === 'picAdd' || event.type === 'picRemove') {

                return;
                if(!props.master.client) return;
                if(event.event.origin === props.master.client.peerId) return;
                //if(event.event.peerId === props.master.client.peerId) return;
                action = event.type === 'picAdd' ? 'added' : 'removed';
                peer = self.topology.peers[event.event.origin];
                const origin = peer ? ' by ' + peer.originPlatform : '';
                msg = 'Image ' + action + ': ' + event.event.file + origin;

            } else if(event.type === 'downloading') {

                return;
                msg = event.event.toAddr + ' is ' + event.type + ' ' + event.event.label + ' from ' + event.event.fromAddr;
            } else if(event.type === 'downloaded') {

                if(event.event.downloader === props.master.client.peerId || !self.state.urls) {
                    return;
                }
                const downHash = event.event.downloader;
                peer = self.peers.find(item => item.peerId === downHash);
                peer = peer && self.state ? peer : self.state.urls
                    .map(item => item.owners)
                    .flatMap(item => item)
                    .filter(item => item)
                    .find(owner => {
                        return owner.peerId === downHash
                    });
                const downloader = peer ? ' by ' + (peer.name || peer.originPlatform || peer.platform) : '';
                msg = 'Image ' + event.event.file + ' ' + event.type + downloader;
                //self.displayNotification(msg);
            } else if(event.type === 'serverPeer') {
                //if(event.event.peerId === props.master.client.peerId) return;
                msg = 'Server peer photogroup.network seeds ' + event.event.action;
            }

            const {enqueueSnackbar, closeSnackbar} = self.props;
            enqueueSnackbar(msg, {
                variant: event.level,
                autoHideDuration: 6000,
                action: (key) => (<Button style={{color: 'white'}} size="small" onClick={ () => closeSnackbar(key) }>x</Button>)
            });
        });

        this.icegatheringstatechange = '';
        this.iceconnectionstatechange = '';
        this.signalingstatechange = '';

        this.state = {
            loader: {},
            expandedNetwork: true,
            expandedGallery: true,
            expandedInfo: true,
            eventStatus: '',
            selectedNodeLabel: '',
            peers: this.topology.peers,
            graph: this.topology.graph,
            options: this.topology.options,
            events: this.topology.events,
            showTopology: false,
        };

        emitter.on('showTopology', value => {
            this.setState({showTopology: value});
        });

        emitter.on('pcEvent', (type, value) => {

            this[type] = value;

            //scope.emitter.emit('pcEvent', 'icegatheringstatechange', '');
            //scope.emitter.emit('pcEvent', 'iceconnectionstatechange', '');
            //scope.emitter.emit('pcEvent', 'signalingstatechange', '');

            this.setState({
                eventStatus: this.icegatheringstatechange
                    + ' ' + this.iceconnectionstatechange
                    + ' ' + this.signalingstatechange
            });
        });

        emitter.on('webPeers', peers => {

            this.peers = peers;
            emitter.emit('pcEvent', 'icegatheringstatechange', '');
            emitter.emit('pcEvent', 'iceconnectionstatechange', '');
            emitter.emit('pcEvent', 'signalingstatechange', '');
        });

        emitter.on('topStateMessage', msg => {

            this.setState({
                selectedNodeLabel: msg
            });
        });

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

    snack(payload, type = 'info', persist = false) {

        const {enqueueSnackbar, closeSnackbar} = this.props;

        enqueueSnackbar(payload, {
            variant: type,
            persist: persist,
            autoHideDuration: 4000,
            action: (key) => (<Button className={this.props.classes.white} onClick={ () => closeSnackbar(key) } size="small">x</Button>),
            anchorOrigin: {
                vertical: 'bottom',
                horizontal: 'right'
            }
        });
    }


    handleExpand = panel => (event, expanded) => {
        if(panel === 'expandedNetwork') {

            this.topology.isOpen = expanded;
            if(expanded)
                    this.topology.build();
        }
        this.setState({
            [panel]: expanded,
        });
    };

    setNetworkInstance = nw => {
        const network = this.network = nw;

        //network.setOptions({
        //    physics: {enabled:false}
        //});

        this.setState({network: network});
    };

    createNetworkTopology(expandedNetwork, classes, eventStatus, selectedNodeLabel) {
        return <ExpansionPanel expanded={expandedNetwork} onChange={this.handleExpand('expandedNetwork')}>
            <ExpansionPanelSummary expandIcon={<ExpandMoreIcon />}>
                <Typography className={classes.heading}>Network Topology</Typography>
            </ExpansionPanelSummary>
            <ExpansionPanelDetails className={classes.content} style={{
                display: 'flex',
                flexDirection: 'column'
            }}>
                {this.showStatusMessage(eventStatus, selectedNodeLabel, classes)}
                <Graph ref={node => this.graph = node} getNetwork={this.setNetworkInstance}
                       graph={this.state.graph} options={this.state.options} events={this.state.events}
                       style={{width: "100%", height: "400px"}}/>
            </ExpansionPanelDetails>
        </ExpansionPanel>;
    }

    showStatusMessage(eventStatus, selectedNodeLabel, classes) {

        return <Typography variant="caption" align="center" className={classes.wordwrap}>
            <div>{selectedNodeLabel}</div>
            <div>{eventStatus}</div>
            {/*<div>ratio: {client.ratio} progress: {client.progress} up: {client.uploadSpeed} down: {client.downloadSpeed}</div>*/}
        </Typography>
    }

    render() {

        const defaultTheme = createMuiTheme();

        const { classes, master } = this.props;
        const {eventStatus, selectedNodeLabel, expandedNetwork,
            showTopology} = this.state;

        const graphDom = showTopology ?
            this.createNetworkTopology(expandedNetwork, classes, eventStatus, selectedNodeLabel)
            : '';

        //{this.showStatusMessage(eventStatus, selectedNodeLabel, classes)}
        return (
            <ThemeProvider theme={defaultTheme}>

                {<QRCodeView master={master}/>}
                {graphDom}
                <OtherPeersView master={master} />
                <MeView master={master} />
                <Gallery className={classes.nooverflow} model={this.gallery} master={master} />

            </ThemeProvider>
        );
    }
}

ShareCanvas.propTypes = {
    classes: PropTypes.object.isRequired,
    gallery: PropTypes.object.isRequired,
};

export default withSnackbar(withStyles(styles)(ShareCanvas));