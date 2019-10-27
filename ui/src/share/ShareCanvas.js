import React, { Component } from 'react';
import PropTypes from 'prop-types';
import Gallery from "./gallery/Gallery";

import { makeStyles } from '@material-ui/styles';
import IconButton from '@material-ui/core/IconButton';
import Button from '@material-ui/core/Button';
import Card from '@material-ui/core/Card';
import CardHeader from '@material-ui/core/CardHeader';
import CardContent from '@material-ui/core/CardContent';
import CloudUploadIcon from '@material-ui/icons/CloudUpload';
import CloudDownloadIcon from '@material-ui/icons/CloudDownload';
import ClearIcon from '@material-ui/icons/Delete';

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

const styles = theme => makeStyles({
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

    button: {
        margin: theme.spacing(1),
    },
    rightIcon: {
        marginLeft: theme.spacing(1),
    },
    card: {
        margin: theme.spacing(1),
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'center',
        flexDirection: 'column',
    },
    item: {
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'left',
        flexDirection: 'row',
    },
    cardContent: {
        alignItems: 'left',
        justifyContent: 'left',
        textAlign: 'left'
    },
    white: {
        color: '#ffffff'
    },
    wordwrap: {
        wordWrap: 'break-word'
    }
});

class ShareCanvas extends Component {

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

        emitter.on('addPeerDone', () => {
            //self.topology.start();
            this.setState({peerId: this.master.client.peerId})
        });

        let progressRunner;
        emitter.on('wtInitialized', client => {
            progressRunner = setInterval(() => {

                /*this.setState({

                    loader: {
                        progress: client.progress.toFixed(1) * 100,
                        ratio: client.ratio,
                        downloadSpeed: (client.downloadSpeed / 1024).toFixed(1) + 'kb/s',
                        uploadSpeed: (client.uploadSpeed / 1024).toFixed(1) + 'kb/s'
                    }
                })*/

            }, 1000);
        });

        emitter.on('appEvent', event => {

            let msg = '';
            let action = '';

            if(event.type === 'peerConnect' || event.type === 'peerDisconnect') {

                if(!props.master.client) return;
                if(event.event.peerId === props.master.client.peerId) return;
                action = event.type === 'peerConnect' ? 'connected' : 'disconnected';
                msg = 'Peer ' + action + ': ' + event.event.originPlatform + ' ' + event.event.hostname

            } else if(event.type === 'picAdd' || event.type === 'picRemove') {

                if(!props.master.client) return;
                if(event.event.origin === props.master.client.peerId) return;
                //if(event.event.peerId === props.master.client.peerId) return;
                action = event.type === 'picAdd' ? 'added' : 'removed';
                const peer = self.topology.peers[event.event.origin];
                const origin = peer ? ' by ' + peer.originPlatform : '';
                msg = 'Image ' + action + ': ' + event.event.file + origin;

            } else if(event.type === 'downloading') {
                msg = event.event.toAddr + ' is ' + event.type + ' ' + event.event.label + ' from ' + event.event.fromAddr;
            } else if(event.type === 'downloaded') {
                //props.master.client.peerId
                if(event.event.downloader === props.master.client.peerId) return;
                const peer = self.topology.peers[event.event.downloader];
                const downloader = peer ? ' by ' + peer.originPlatform : '';
                msg = 'Image ' + event.event.file + ' ' + event.type + downloader;
            } else if(event.type === 'serverPeer') {
                //if(event.event.peerId === props.master.client.peerId) return;
                msg = 'Server peer photogroup.network seeds ' + event.event.action;
            }

            self.props.enqueueSnackbar(msg, {
                variant: event.level,
                autoHideDuration: 6000,
                /*action: <Button className={props.classes.white} size="small">x</Button>*/
            });

            if(event.level === 'success') {
                self.displayNotification(msg);
            }
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
            content: [],
            selectedNodeLabel: '',
            peerId: '',

            peers: this.topology.peers,
            graph: this.topology.graph,
            options: this.topology.options,
            events: this.topology.events,
        };

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

        emitter.on('urls', urls => {
            this.setState({
                content: urls
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
        </div>);
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
            autoHideDuration: 2000,
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

    removeTorrent(url) {
        this.master.service.delete(url.hash);
    }

    addServerPeer(url, action) {

        Logger.log(url.url);

        const self = this;
        this.master.service.addServerPeer(url.url).then(result => {

            self.master.emitter.emit('appEventRequest', {level: 'warning', type: 'serverPeer',
                event: {action: action, sharedBy: url.sharedBy}
            });
            Logger.log('Shared server peer ' + result.url);

        }).catch(err => {

            Logger.log('addServerPeer already added? ' + err);

            self.props.enqueueSnackbar('Image already shared with photogroup.network', {
                variant: 'error',
                autoHideDuration: 6000,
                action: <Button className={self.props.classes.white} size="small">x</Button>
            });
        });
    }

    downloadFromServer(index) {
        Logger.log(index);
    }

    removeServerPeer(url, peerId) {
        this.master.service.removeOwner(url.hash, peerId);
    }

    render() {

        const defaultTheme = createMuiTheme();

        const { classes } = this.props;
        const master = this.master;
        const client = this.state.loader;
        const {eventStatus, selectedNodeLabel, expandedNetwork, expandedGallery, expandedInfo, content} = this.state;
        /*const stateGrid = Object.keys(peers).forEach(key => {
            const peer = peers[key];
            return
        });*/

        const self = this;

        const stateGrid = content.map((item, index) => {

            const metadata = window.parsetorrent(item.url);

            const label = metadata.name + ' of ' + item.fileSize + ' first shared by ' + item.sharedBy.originPlatform;

            return <Card key={index} className={classes.card}>
                    <CardHeader title={<Typography className={classes.wordwrap} variant="caption">{label}</Typography>}
                                action={
                                    <div><IconButton onClick={this.addServerPeer.bind(self, item, label)}>
                                        <CloudUploadIcon/>
                                    </IconButton>
                                        <IconButton onClick={this.removeTorrent.bind(self, item)}>
                                            <ClearIcon/>
                                        </IconButton>
                                    </div>

                                }
                    >
                    </CardHeader>
                    {/*<div>
                        <Typography className={classes.wordwrap} variant="caption">{label}</Typography>
                        <IconButton onClick={this.addServerPeer.bind(self, item, label)}>
                            <CloudUploadIcon/>
                        </IconButton>
                    </div>*/}
                    <CardContent className={classes.cardContent} component={'ul'}>
                        <Typography>downloaded by</Typography>
                        {item.owners
                            .map((owner, index) => {

                                const meLabel = owner.peerId === master.client.peerId ? 'me - ' : '';
                                const downloadLabel = meLabel + owner.platform;
                                const clearButton = owner.platform === 'photogroup.network'
                                    ? <IconButton onClick={this.removeServerPeer.bind(self, item, owner.peerId)}>
                                        <ClearIcon/>
                                    </IconButton> : '';
                                return <li className={classes.item} key={index}>
                                        <Typography
                                        className={classes.wordwrap} variant="caption">{downloadLabel}
                                        </Typography>
                                        {clearButton}
                                </li>})}
                    </CardContent>

                    {/*<IconButton onClick={this.downloadFromServer.bind(self, index)}>
                        <CloudDownloadIcon/>
                    </IconButton>*/}
            </Card>;
        });

        //const stateGridTitle = content.length > 0 ? <Typography>Add Server Peer to</Typography> : '';

        return (
            <ThemeProvider theme={defaultTheme}>
                <Typography variant="caption" align="center" className={classes.wordwrap}>
                    <div>{this.state.peerId}</div>
                    <div>{selectedNodeLabel}</div>
                    <div>{eventStatus}</div>
                    <div>ratio: {client.ratio} progress: {client.progress} up: {client.uploadSpeed} down: {client.downloadSpeed}</div>
                </Typography>

                <ExpansionPanel expanded={expandedNetwork} onChange={this.handleExpand('expandedNetwork')}>
                    <ExpansionPanelSummary expandIcon={<ExpandMoreIcon />}>
                        <Typography className={classes.heading}>Network Topology</Typography>
                    </ExpansionPanelSummary>
                    <ExpansionPanelDetails className={classes.content}>
                        <Graph ref={node => this.graph = node} getNetwork={this.setNetworkInstance}
                               graph={this.state.graph} options={this.state.options} events={this.state.events}
                               style={{width: "100%", height: "400px"}}/>
                    </ExpansionPanelDetails>
                </ExpansionPanel>


                <ExpansionPanel expanded={expandedInfo} onChange={this.handleExpand('expandedInfo')}>
                    <ExpansionPanelSummary expandIcon={<ExpandMoreIcon />}>
                        <Typography className={classes.heading}>Download Status</Typography>
                    </ExpansionPanelSummary>
                    <ExpansionPanelDetails>
                        <div>
                            <div>{stateGrid}</div>
                        </div>
                    </ExpansionPanelDetails>
                </ExpansionPanel>

                <ExpansionPanel className={classes.nooverflow}
                                expanded={expandedGallery} onChange={this.handleExpand('expandedGallery')}>
                    <ExpansionPanelSummary className={classes.nooverflow} expandIcon={<ExpandMoreIcon />}>
                        <Typography className={classes.heading}>Gallery</Typography>
                    </ExpansionPanelSummary>
                    <ExpansionPanelDetails className={classes.content}>
                        <Gallery className={classes.nooverflow} model={this.gallery} />
                    </ExpansionPanelDetails>
                </ExpansionPanel>
            </ThemeProvider>
        );
    }
}

ShareCanvas.propTypes = {
    classes: PropTypes.object.isRequired,
    gallery: PropTypes.object.isRequired,
};

export default withSnackbar(withStyles(styles)(ShareCanvas));