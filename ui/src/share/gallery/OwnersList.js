import React, { Component } from 'react';
import {withStyles} from '@mui/styles';
import Typography from "@mui/material/Typography";
import List from "@mui/material/List";
import ListItem from "@mui/material/ListItem";
import AccountCircleRounded from "@mui/icons-material/AccountCircleRounded";
import GroupRounded from "@mui/icons-material/GroupRounded";
import Paper from "@mui/material/Paper";
import Logger from 'js-logger';
import _ from 'lodash';

import Accordion from '@mui/material/Accordion';
import AccordionSummary from '@mui/material/AccordionSummary';
import AccordionDetails from '@mui/material/AccordionDetails';
import ExpandMoreIcon from '@mui/icons-material/ExpandMore';
import Badge from "@mui/material/Badge";
import StringUtil from "../util/StringUtil";
import CheckIcon from "@mui/icons-material/CheckRounded";
import NatListItem from "../util/NatListItem";
import UserListItem from "../util/UserListItem";

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
            peerItems: peers,
            newConnections: []
        };

        emitter.on('numPeersChange', this.handlePeersUpdate, this);
        emitter.on('peerConnections', this.handlePeersConnectionUpdate, this);
    }

    handlePeersUpdate(len, peers) {
        this.setState({peerItems: peers});
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
        this.props.emitter.removeListener('numPeersChange', this.handlePeersUpdate, this);
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
                //Logger.error('hasOwners Cannot find peerId ' + owner.peerId);
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
        //const connectLabel = `${names} ${haveHas} this image${conns}`;
        const connectLabel = `${names}${conns}`;

        const anyoneLoading = owners.some(item => item.loading);
        let overallProgress = '';
        if(anyoneLoading) {
            const sumProgress = owners.map(item => item.progress || 100).reduce((a, b) => a + b, 0);
            overallProgress = Math.round((sumProgress / owners.length)) || '';
            overallProgress = overallProgress || overallProgress !== '' ? overallProgress + '%' : '';
            overallProgress = overallProgress === '100%' ? '' : overallProgress;
            overallProgress = overallProgress === '' ? <CheckIcon /> : overallProgress;
        }
        overallProgress = overallProgress === '' ? <CheckIcon /> : overallProgress;
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
               }} variant="caption">{connectLabel}</Typography>
            </span>
            <Typography variant="caption">{overallProgress}</Typography>
        </span>
    }

    renderOwners(otherPeers, peers, tile, classes) {
        const nats = otherPeers.map(owner => {

            const peer = peers.items.find(item => item.peerId === owner.peerId);
            if(!peer) {
                //Logger.error('Cannot find peerId ' + owner.peerId);
                return;
            }
            let nat = peer.networkChain
                ? peer.networkChain.find(item => (item.type.includes('srflx') || item.type.includes('prflx'))
                    && item.label) : null;
            if(!nat) {

                nat = peer.networkChain
                    ? peer.networkChain.find(item => (item.type.includes('srflx') || item.type.includes('prflx'))) : null;
                if(!nat) {
                    Logger.error('Cannot find nat ' + peer.name + ' ' + owner.peerId);
                    return;
                }
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

                    const progress = isNaN(owner.progress) ? '' : owner.progress + '%';

                    return <span key={clientIndex} className={classes.horizontal} style={{
                                justifyContent: 'left'
                            }}>
                        <span style={{
                            position: 'relative',
                            textAlign: 'center',
                            //marginRight: '10px'
                        }}>
                            <span className={classes.vertical} style={{
                                justifyContent: 'left'
                            }}>
                                {connection ? <Typography variant="caption">{connection.connectionType}</Typography> : ''}
                                {owner.loading ? <Typography variant="caption">Loading {progress}</Typography> : ''}
                            </span>
                        </span>
                        <UserListItem peer={peer} />
                    </span>;
                });

                const nat = natClients[0].nat;
                return <ListItem key={index} className={classes.vertical}>
                    <NatListItem nat={nat} />
                    {clients}
                </ListItem>;
            });
    }

    render() {
        const {classes, myPeerId, tile} = this.props;
        const {peerItems, newConnections, expanded} = this.state;

        const peers = peerItems;
        const otherPeers = tile.owners.filter(item => item.peerId !== myPeerId);
        let photoConnections = newConnections;
        if(peers.connections && peers.connections.length > 0) {
            photoConnections = peers.connections.filter(item => item.infoHash === tile.infoHash);
        }
        const connectionTypes = [...new Set(photoConnections.map(item => item.connectionType))].join(', ');

        //Logger.info('tile.owners ' + JSON.stringify(otherPeers));
        return (
            this.hasOwners(otherPeers, peers) ?
                <Accordion expanded={expanded}
                                style={{
                                    marginBottom: '10px', marginLeft: '10px', marginRight: '10px'
                                }}
                                onChange={this.handleExpand('expanded')}>
                    <AccordionSummary expandIcon={<ExpandMoreIcon />}>
                        {this.buildHeader(otherPeers, peers, connectionTypes, classes)}
                    </AccordionSummary>
                    <AccordionDetails className={classes.content}>
                        <Paper style={{
                            margin: '10px',
                            //padding: '10px'
                        }}>
                            <List>
                                {
                                    this.renderOwners(otherPeers, peers, tile, classes)
                                }
                            </List>
                        </Paper>
                    </AccordionDetails>
                </Accordion> : <Typography variant="caption">No peer has this image</Typography>
        );
    }
}

export default withStyles(styles)(OwnersList);