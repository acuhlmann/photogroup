import React, { Component } from 'react';
import PropTypes from 'prop-types';
import Gallery from "./gallery/Gallery";

import { makeStyles } from '@material-ui/styles';
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

import Paper from "@material-ui/core/Paper";
import CircularProgress from '@material-ui/core/CircularProgress';
import { green } from '@material-ui/core/colors';
import Fab from '@material-ui/core/Fab';
import CheckIcon from '@material-ui/icons/CheckRounded';
import ImageIcon from '@material-ui/icons/ImageRounded';
import AccountCircleRounded from '@material-ui/icons/AccountCircleRounded';
import List from '@material-ui/core/List';
import ListItem from '@material-ui/core/ListItem';
import Divider from '@material-ui/core/Divider';
import IconButton from "@material-ui/core/IconButton";
import ClearIcon from '@material-ui/icons/Delete';
import QRCode from "./security/QRCode";

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
    fabProgress: {
        position: 'absolute',
        zIndex: 1,
        left: '-7px',
        top: '-5px'
    },
    imageIcon: {
        position: 'relative',
        //left: '-7px',
        //top: '-5px'
    },
    vertical: {
        display: 'flex',
        flexDirection: 'column'
    },
    verticalAndWide: {
        display: 'flex',
        flexDirection: 'column',
        width: '100%'
    },
    horizontal: {
        display: 'flex',
        flexDirection: 'row',
        alignItems: 'center',
        justifyContent: 'center'
    }
});

class OtherPeersView extends Component {

    constructor(props) {
        super(props);

        const {enqueueSnackbar} = props;

        if(!window.WebTorrent.WEBRTC_SUPPORT) {
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

        this.master.emitter.on('urls', urls => {

            this.setState({
                urls: urls
            });
        });

        this.master.emitter.on('networkTopology', data => {

            if(!props.master.client) return;
            this.setState({
                otherPeers: data.nodes
                    .filter(item => item.networkType === 'client'
                        && item.peerId !== props.master.client.peerId)
                    .filter(item => {
                        if(item.originPlatform === 'photogroup.network'
                            && item.network && item.network.type !== 'host')
                            return false;
                        else
                            return true;
                    })
            });
        });

        emitter.on('appEvent', event => {

            let msg = '';
            let action = '';

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
                const peer = self.topology.peers[event.event.origin];
                const origin = peer ? ' by ' + peer.originPlatform : '';
                msg = 'Image ' + action + ': ' + event.event.file + origin;

            } else if(event.type === 'downloading') {

                return;
                msg = event.event.toAddr + ' is ' + event.type + ' ' + event.event.label + ' from ' + event.event.fromAddr;
            } else if(event.type === 'downloaded') {

                if(event.event.downloader === props.master.client.peerId) {
                    return;
                }
                const downHash = event.event.downloader;
                let peer = self.topology.peers[downHash];
                peer = peer && self.state ? peer : self.state.urls
                    .map(item => item.owners)
                    .flatMap(item => item)
                    .filter(item => item)
                    .find(owner => {
                        return owner.peerId === downHash
                    });
                const downloader = peer ? ' by ' + (peer.originPlatform || peer.platform) : '';
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
            expandedPeers: true,
            expandedGallery: true,
            expandedInfo: true,
            eventStatus: '',
            selectedNodeLabel: '',
            peers: this.topology.peers,
            graph: this.topology.graph,
            options: this.topology.options,
            events: this.topology.events,
            showTopology: false,
            showOtherPeers: true,
            otherPeers: []
        };

        emitter.on('showTopology', value => {
            this.setState({showTopology: value});
        });

        emitter.on('showOtherPeers', value => {
            this.setState({showOtherPeers: value});
        });

        emitter.on('pcEvent', (type, value) => {

            this[type] = value;

            this.setState({
                eventStatus: this.icegatheringstatechange
                    + ' ' + this.iceconnectionstatechange
                    + ' ' + this.signalingstatechange
            });
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

        if('Notification' in window && navigator.serviceWorker) {
            console.info('Notification.permission ' + Notification.permission);
            if(Notification.permission === 'granted') {

            } else if(Notification.permission === 'blocked') {

                this.askForPush();
            } else {

                this.askForPush();
            }
        }
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

    createNetworkTopology(expandedNetwork, classes) {
        return <ExpansionPanel expanded={expandedNetwork} onChange={this.handleExpand('expandedNetwork')}>
            <ExpansionPanelSummary expandIcon={<ExpandMoreIcon />}>
                <Typography className={classes.heading}>Network Topology</Typography>
            </ExpansionPanelSummary>
            <ExpansionPanelDetails className={classes.content}>
                <Graph ref={node => this.graph = node} getNetwork={this.setNetworkInstance}
                       graph={this.state.graph} options={this.state.options} events={this.state.events}
                       style={{width: "100%", height: "400px"}}/>
            </ExpansionPanelDetails>
        </ExpansionPanel>;
    }

    removeServerPeer(hash, peerId) {
        this.master.service.removeOwner(hash, peerId);
    }

    createWhatPeersHave(otherPeers, expandedPeers, classes) {

        return <ExpansionPanel expanded={expandedPeers} onChange={this.handleExpand('expandedPeers')}>
            <ExpansionPanelSummary expandIcon={<ExpandMoreIcon />}>
                <Typography className={classes.heading}>Other Peers</Typography>
            </ExpansionPanelSummary>
            <ExpansionPanelDetails className={classes.content}>
                <div className={classes.verticalAndWide}>
                    <QRCodeButton/>
            {
                otherPeers.map((peer, index) => {

                    const owns = this.state.urls ? this.state.urls
                        .map(url => {
                            return url.owners.map(item => {
                                item.url = url;
                                return item;
                            })
                        })
                        .flatMap(item => item)
                        .filter(item => item.peerId === peer.peerId)
                        .map(item => item.url) : [];

                    return <Paper key={index} style={{
                                                margin: '10px',
                                                padding: '10px'
                                            }}>
                        <span
                            className={classes.horizontal}>
                            <AccountCircleRounded/>
                            <Typography variant="caption" style={{
                                marginLeft: '5px'
                            }}>{peer.label}</Typography>
                        </span>
                        {owns.length > 0 ? <Divider variant="middle" /> : ''}
                        {owns.length > 0 ?
                            <List>
                                {
                                owns.map((url, index) => {
                                    const have = url.owners
                                        .find(owner => owner.peerId === this.master.client.peerId);
                                    const pgOwner = url.owners
                                        .find(owner => owner.platform === 'photogroup.network');
                                    return <ListItem key={index}>
                                            <span style={{
                                                position: 'relative',
                                                textAlign: 'center',
                                                marginRight: '10px'
                                            }}>
                                                {have ? <CheckIcon /> : <ImageIcon className={classes.imageIcon} />}
                                                {!have && <CircularProgress
                                                    color="secondary"
                                                    size={36} className={classes.fabProgress} />}
                                            </span>
                                            {
                                                pgOwner
                                                ? <IconButton
                                                        onClick={this.removeServerPeer.bind(this,
                                                            pgOwner.url.hash, pgOwner.peerId)}>
                                                <ClearIcon/>
                                            </IconButton> : ''
                                            }
                                            <Typography variant="caption" className={classes.wordwrap}>
                                            {url.picSummary} {url.fileSize} {url.cameraSettings}
                                        </Typography>
                                        </ListItem>;
                                    })
                                }
                            </List>
                            : ''}
                    </Paper>
                })
            }
                </div>
            </ExpansionPanelDetails>
        </ExpansionPanel>
    }

    render() {

        const defaultTheme = createMuiTheme();

        const { classes, master } = this.props;
        const {eventStatus, selectedNodeLabel, expandedNetwork,
            expandedPeers, showTopology, showOtherPeers, otherPeers} = this.state;

        const graphDom = showTopology ?
            this.createNetworkTopology(expandedNetwork, classes)
            : '';

        let otherPeersView;
        if(showOtherPeers) {
            otherPeersView = otherPeers.length > 0
                ? this.createWhatPeersHave(otherPeers, expandedPeers, classes)
                : <Typography variant={"caption"}>No other peers</Typography>;
        }

        return (
            <ThemeProvider theme={defaultTheme}>
                <Typography variant="caption" align="center" className={classes.wordwrap}>
                    <div>{selectedNodeLabel}</div>
                    <div>{eventStatus}</div>
                    {/*<div>ratio: {client.ratio} progress: {client.progress} up: {client.uploadSpeed} down: {client.downloadSpeed}</div>*/}
                </Typography>

                {graphDom}
                {otherPeersView}
                <Gallery className={classes.nooverflow} model={this.gallery} master={master} />

            </ThemeProvider>
        );
    }
}

OtherPeersView.propTypes = {
    classes: PropTypes.object.isRequired,
    gallery: PropTypes.object.isRequired,
};

export default withSnackbar(withStyles(styles)(OtherPeersView));