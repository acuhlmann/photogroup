import React, { Component } from 'react';
import {withStyles} from '@material-ui/core/styles';
import Typography from "@material-ui/core/Typography";
import List from "@material-ui/core/List";
import ListItem from "@material-ui/core/ListItem";
import AccountCircleRounded from "@material-ui/icons/AccountCircleRounded";
import GroupRounded from "@material-ui/icons/GroupRounded";
import update from "immutability-helper";
import Paper from "@material-ui/core/Paper";
import Logger from 'js-logger';
import _ from 'lodash';

import ExpansionPanel from '@material-ui/core/ExpansionPanel';
import ExpansionPanelSummary from '@material-ui/core/ExpansionPanelSummary';
import ExpansionPanelDetails from '@material-ui/core/ExpansionPanelDetails';
import ExpandMoreIcon from '@material-ui/icons/ExpandMore';
import Badge from "@material-ui/core/Badge";
import StringUtil from "../util/StringUtil";

const styles = theme => ({
    vertical: {
        width: '100%',
        display: 'flex',
        flexDirection: 'column',
        alignItems: 'center',
        justifyContent: 'center'
    },
    verticalAndWide: {
        display: 'flex',
        flexDirection: 'column',
        width: '100%'
    },
    horizontal: {
        width: '100%',
        display: 'flex',
        flexDirection: 'row',
        alignItems: 'center',
        justifyContent: 'center'
    },
    content: {
        padding: '0px 0px 0px 0px',
        width: '100%',
        overflow: 'hidden'
    },
});

class OwnersList extends Component {

    constructor(props) {
        super(props);

        const {emitter, peers} = props;

        this.state = {
            expanded: false,
            peerItems: peers.items,
            newConnections: []
        };

        emitter.on('peers', this.handlePeersUpdate, this);
        emitter.on('peerConnections', this.handlePeersConnectionUpdate, this);
    }

    handlePeersUpdate(event) {
        const {myPeerId, peers} = this.props;
        if(event.type === 'update' && event.item.peerId !== myPeerId) {
            const index = peers.items.findIndex(item => item.peerId === event.item.peerId);
            if(index > -1) {
                peers.items = update(peers.items, {$splice: [[index, 1, event.item]]});
                this.setState({peerItems: peers.items});
            }
        }
    }

    handlePeersConnectionUpdate(connections) {
        const {tile} = this.props;
        if(connections && connections.length > 0) {
            const photoConnections = connections.filter(item => item.infoHash === tile.infoHash);
            if(photoConnections.length > 0) {
                this.setState({newConnections: photoConnections});
            }
        }
    }

    componentWillUnmount() {
        this.props.emitter.removeListener('peers', this.handlePeersUpdate, this);
        this.props.emitter.removeListener('peerConnections', this.handlePeersConnectionUpdate, this);
    }

    handleExpand = panel => (event, expanded) => {
        this.setState({
            [panel]: expanded,
        });
    };

    hasOwners(owners, peers) {
        const anyFound = owners.some(owner => {
            const peer = peers.items.find(peer => peer.peerId === owner.peerId);
            if(!peer) {
                Logger.error('hasOwners Cannot find peerId ' + owner.peerId);
            }
            return peer ? owner : undefined;
        });
        return owners && owners.length > 0 && anyFound;
    }

    buildHeader(owners, peers, connectionTypes, classes) {
        const numOfOwners = owners.length;
        const names = owners.map(owner => {
            let name = owner.peerId;
            name = _.truncate(name, {length: 10});
            const peer = peers.items.find(item => item.peerId === owner.peerId);
            if(peer) {
                name = peer.name || _.truncate(peer.originPlatform, {length: 10});
            }
            return name;
        }).join(', ');
        const haveHas = numOfOwners > 1 ? 'have' : 'has';
        /*if(numOfOwners > 1) {
            names.split(', ').join('')
        }*/

        const conns = connectionTypes ? ' connected via ' + connectionTypes : '';

        const anyoneLoading = owners.some(item => item.loading);
        let overallProgress = '';
        if(anyoneLoading) {
            const sumProgress = owners.map(item => item.progress || 100).reduce((a, b) => a + b, 0);
            overallProgress = Math.round((sumProgress / owners.length)) || '';
            overallProgress = overallProgress || overallProgress !== '' ? overallProgress + '%' : '';
            overallProgress = overallProgress === '100%' ? '' : overallProgress;
        }
        return <span style={{
                    display: 'flex',
                    flexDirection: 'row',
                    alignItems: 'center',
                    justifyContent: 'space-around',
                    width: '100%'
                }}>
                <span style={{
                display: 'flex',
                flexDirection: 'row',
                alignItems: 'center',
                justifyContent: 'left',
                width: '100%'
            }}>
                <Badge badgeContent={numOfOwners} color="primary" >
                        <GroupRounded />
                    </Badge>
               <Typography style={{
                   marginLeft: '20px'
               }} variant="caption">{names} {haveHas} this image{conns}</Typography>
            </span>
            <Typography variant="caption">{overallProgress}</Typography>
        </span>
    }

    renderOwners(otherPeers, peers, tile, classes) {
        const nats = otherPeers.map(owner => {

            const peer = peers.items.find(item => item.peerId === owner.peerId);
            if(!peer) {
                Logger.error('Cannot find peerId ' + owner.peerId);
                return;
            }
            const nat = peer.networkChain
                ? peer.networkChain.find(item => (item.type.includes('srflx') || item.type.includes('prflx'))
                    && item.label) : null;
            if(!nat) {
                Logger.error('Cannot find nat ' + peer.name + ' ' + owner.peerId);
                return;
            }

            return {
                natIp: nat.ip,
                nat: nat,
                owner: owner,
                peer: peer
            }
        }).filter(item => item);

        const groups = _.groupBy(nats, 'natIp');

        return Object.values(groups)
            .map((natClients, index) => {

                const clients = natClients.map((natClient, clientIndex) => {

                    const {owner, peer} = natClient;

                    let connection;
                    if(peers.connections && peers.connections.length > 0) {
                        const photoConnections = peers.connections.filter(item => item.infoHash === tile.infoHash);
                        connection = photoConnections.find(item => item.fromPeerId === owner.peerId
                            || item.toPeerId === owner.peerId);
                    }
                    //owner.loading = true;
                    //connection = {connectionType: 'p2p'};

                    const progress = owner.progress === '' ? '' : owner.progress + '%';

                    return <span key={clientIndex} className={classes.horizontal}>
                        <span style={{
                            position: 'relative',
                            textAlign: 'center',
                            marginRight: '10px'
                        }}>
                            <span className={classes.vertical}>
                                {connection ? <Typography variant="caption">{connection.connectionType}</Typography> : ''}
                                {owner.loading ? <Typography variant="caption">Loading {progress}</Typography> : ''}
                            </span>
                        </span>
                        <span
                            className={classes.horizontal}
                            style={{
                                justifyContent: 'left'
                        }}>
                            <AccountCircleRounded/>
                            <Typography variant="caption" style={{
                                marginLeft: '5px'
                            }}>{this.createClientLabel(peer)}</Typography>
                        </span>
                    </span>;
                });

                const nat = natClients[0].nat;
                return <ListItem key={index} className={classes.vertical}>
                    {nat ? <span
                        className={classes.horizontal}>
                                <img src={"./firewall.png"} alt="firewall" style={{
                                    width: '20px'
                                }}/>
                                <Typography variant="caption" style={{
                                    marginLeft: '5px'
                                }}>{StringUtil.createNetworkLabel(nat)}</Typography>
                            </span> : ''}
                    {clients}
                </ListItem>;
            });
    }

    createClientLabel(peer) {

        return StringUtil.addEmptySpaces([
            peer.connectionSpeedType,
            peer.name,
            peer.originPlatform
        ]);
    }

    render() {
        const {classes, owners, myPeerId, peers, tile} = this.props;
        const {peerItems, newConnections, expanded} = this.state;

        const otherPeers = owners.filter(item => item.peerId !== myPeerId);
        let photoConnections = newConnections;
        if(peers.connections && peers.connections.length > 0) {
            photoConnections = peers.connections.filter(item => item.infoHash === tile.infoHash);
        }
        const connectionTypes = photoConnections.map(item => item.connectionType).join(', ');

        //Logger.info('owners ' + JSON.stringify(otherPeers));
        return (
            this.hasOwners(otherPeers, peers) ?
                <ExpansionPanel expanded={expanded}
                                style={{
                                    marginBottom: '10px', marginLeft: '10px', marginRight: '10px'
                                }}
                                onChange={this.handleExpand('expanded')}>
                    <ExpansionPanelSummary expandIcon={<ExpandMoreIcon />}>
                        {this.buildHeader(otherPeers, peers, connectionTypes, classes)}
                    </ExpansionPanelSummary>
                    <ExpansionPanelDetails className={classes.content}>
                        <Paper style={{
                            margin: '10px',
                            padding: '10px'
                        }}>
                            <List>
                                {
                                    this.renderOwners(otherPeers, peers, tile, classes)
                                }
                            </List>
                        </Paper>
                    </ExpansionPanelDetails>
                </ExpansionPanel> : <Typography variant="caption">No peer has this image</Typography>
        );
    }
}

export default withStyles(styles)(OwnersList);