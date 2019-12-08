import React, { Component } from 'react';
import PropTypes from 'prop-types';
import {withStyles } from '@material-ui/core/styles';
import Button from '@material-ui/core/Button';
import ExpansionPanel from '@material-ui/core/ExpansionPanel';
import ExpansionPanelSummary from '@material-ui/core/ExpansionPanelSummary';
import ExpansionPanelDetails from '@material-ui/core/ExpansionPanelDetails';
import Typography from '@material-ui/core/Typography';
import ExpandMoreIcon from '@material-ui/icons/ExpandMore';
import { withSnackbar } from 'notistack';

import Graph from 'vis-react';
import Logger from 'js-logger';
import TopologyHelper from "./TopologyHelper";
import update from 'immutability-helper';

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

    wordwrap: {
        wordWrap: 'break-word'
    },
});

class TopologyView extends Component {

    constructor(props) {
        super(props);

        const self = this;
        this.master = props.master;
        const {emitter} = props.master;

        this.icegatheringstatechange = '';
        this.iceconnectionstatechange = '';
        this.signalingstatechange = '';

        this.topology = new TopologyHelper(this, emitter, this.master);
        this.state = {
            peers: this.topology.peers,
            showTopology: false,
            graph: this.topology.graph,
            options: this.topology.options,
            events: this.topology.events,
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

        emitter.on('urls', urls => {

            this.setState({
                urls: update(this.state.urls, {$set: urls})
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
    }

    setNetworkInstance = nw => {
        const network = this.network = nw;

        //network.setOptions({
        //    physics: {enabled:false}
        //});

        this.setState({network: network});
    };

    showStatusMessage(eventStatus, selectedNodeLabel, classes) {

        return <Typography variant="caption" align="center" className={classes.wordwrap}>
            <div>{selectedNodeLabel}</div>
            <div>{eventStatus}</div>
            {/*<div>ratio: {client.ratio} progress: {client.progress} up: {client.uploadSpeed} down: {client.downloadSpeed}</div>*/}
        </Typography>
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

    render() {

        const {expandedNetwork, classes} = this.props
        const {showTopology, eventStatus, selectedNodeLabel} = this.state;

        return (
            showTopology ? <ExpansionPanel expanded={expandedNetwork} onChange={this.handleExpand('expandedNetwork')}>
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
            </ExpansionPanel> : ''
        );
    }
}

TopologyView.propTypes = {
    classes: PropTypes.object.isRequired,
};

export default withSnackbar(withStyles(styles)(TopologyView));