import React, { Component } from 'react';
import {withStyles} from '@material-ui/core/styles';
import Typography from "@material-ui/core/Typography";
import List from "@material-ui/core/List";
import ListItem from "@material-ui/core/ListItem";
import AccountCircleRounded from "@material-ui/icons/AccountCircleRounded";
import update from "immutability-helper";
import Paper from "@material-ui/core/Paper";
import Logger from 'js-logger';

const styles = theme => ({
    vertical: {
        width: '100%',
        display: 'flex',
        flexDirection: 'column',
        alignItems: 'center',
        justifyContent: 'center'
    },
    horizontal: {
        width: '100%',
        display: 'flex',
        flexDirection: 'row',
        alignItems: 'center',
        justifyContent: 'center'
    }
});

class OwnersList extends Component {

    constructor(props) {
        super(props);

        const {emitter, peers} = props;

        this.state = {
            peerItems: peers.items,
            photoConnections: []
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
                this.setState({newConnections: connections});
            }
        }
    }

    componentWillUnmount() {
        this.props.emitter.removeListener('peers', this.handlePeersUpdate, this);
        this.props.emitter.removeListener('peerConnections', this.handlePeersConnectionUpdate, this);
    }

    hasOwners(owners, peers) {
        const allFound = owners.every(owner => {
            const peer = peers.items.find(peer => peer.peerId === owner.peerId);
            if(!peer) {
                Logger.error('hasOwners Cannot find peerId ' + owner.peerId);
            }
            return peer ? owner : undefined;
        });
        return owners && owners.length > 0 && allFound;
    }

    render() {
        const {classes, owners, myPeerId, peers, tile} = this.props;
        const {peerItems, newConnections} = this.state;

        Logger.info('owners ' + JSON.stringify(owners));
        return (
            this.hasOwners(owners, peers) ? <Paper style={{
                margin: '10px',
                padding: '10px'
            }}>
                <List>
                    {
                        owners
                            .filter(item => item.peerId !== myPeerId)
                            .map((owner, index) => {

                            let connection;
                            if(peers.connections && peers.connections.length > 0) {
                                const photoConnections = peers.connections.filter(item => item.infoHash === tile.infoHash);
                                connection = photoConnections.find(item => item.fromPeerId === owner.peerId
                                    || item.toPeerId === owner.peerId);
                            }

                            const peer = peers.items.find(item => item.peerId === owner.peerId);
                            if(!peer) {
                                Logger.error('Cannot find peerId ' + owner.peerId);
                                return '';
                            }
                            const nat = peer.networkChain
                                ? peer.networkChain.find(item => (item.type.includes('srflx') || item.type.includes('prflx'))
                                    && item.label) : null;

                            return <ListItem key={index}>
                                            <span style={{
                                                position: 'relative',
                                                textAlign: 'center',
                                                marginRight: '10px'
                                            }}>
                                                <span className={classes.vertical}>
                                                    {connection ? <Typography variant="caption">{connection.connectionType}</Typography> : ''}
                                                    {owner.loading ? <Typography variant="caption">Loading</Typography> : ''}
                                                </span>
                                            </span>
                                    <span className={classes.vertical}>
                                                    {nat ? <span
                                                        className={classes.horizontal}>
                                                            <img src={"./firewall.png"} alt="firewall" style={{
                                                                width: '20px'
                                                            }}/>
                                                            <Typography variant="caption" style={{
                                                                marginLeft: '5px'
                                                            }}>{nat.label} {nat.network.city}</Typography>
                                                        </span> : ''}
                                    <span
                                        className={classes.horizontal}>
                                                    <AccountCircleRounded/>
                                                    <Typography variant="caption" style={{
                                                        marginLeft: '5px'
                                                    }}>{peer.connectionSpeedType} {peer.name} {peer.originPlatform}</Typography>
                                                </span>
                                            </span>
                            </ListItem>;
                        })
                    }
                </List>
            </Paper> : <Typography variant="caption">No peer has this image</Typography>
        );
    }
}

export default withStyles(styles)(OwnersList);