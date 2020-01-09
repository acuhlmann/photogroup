import React, { Component } from 'react';
import {withStyles} from '@material-ui/core/styles';
import Typography from "@material-ui/core/Typography";
import List from "@material-ui/core/List";
import ListItem from "@material-ui/core/ListItem";
import AccountCircleRounded from "@material-ui/icons/AccountCircleRounded";
import update from "immutability-helper";

const styles = theme => ({
    vertical: {
        display: 'flex',
        flexDirection: 'column'
    },
    horizontal: {
        display: 'flex',
        flexDirection: 'row',
        alignItems: 'center',
        justifyContent: 'center'
    }
});

class OwnersList extends Component {

    constructor(props) {
        super(props);

        const {emitter, myPeerId, peers} = props;

        this.state = {
            peerItems: peers.items
        };

        emitter.on('peers', event => {

            if(event.type === 'update' && event.item.peerId === myPeerId) {
                const index = peers.items.findIndex(item => item.peerId === event.item.peerId);
                if(index > -1) {
                    peers.items = update(peers.items, {$splice: [[index, 1, event.item]]});
                    this.setState({peerItems: peers.items});
                }
            }
        });
    }

    render() {
        const {classes, owners, myPeerId} = this.props;
        const {peerItems} = this.state;
        //const owners = tile.owners;

        const connections = [];
        return (
            <List>
                {
                    owners && owners.length > 0 ? owners
                        .filter(item => item.peerId !== myPeerId)
                        .map((owner, index) => {

                        let connection;
                        if(connections && connections.length > 0) {
                            const firstConnection = connections.filter(item => item.infoHash === item.infoHash);
                            connection = firstConnection.find(item => item.fromPeerId === owner.peerId
                                || item.toPeerId === owner.peerId);
                        }

                        const peer = peerItems.find(item => item.peerId === owner.peerId);
                        if(!peer) return '';
                        const nat = peer.networkChain
                            ? peer.networkChain.find(item => item.type === 'srflx' || item.type === 'prflx') : null;

                        return <ListItem key={index}>
                                        <span style={{
                                            position: 'relative',
                                            textAlign: 'center',
                                            marginRight: '10px'
                                        }}>
                                            <span className={classes.vertical}>
                                                {connection ? <Typography variant="caption">{connection.connectionType}</Typography> : ''}
                                            </span>
                                        </span>
                            <span className={classes.vertical}>
                                            {nat ? <span
                                                className={classes.horizontal}>
                                                    <img src={"./firewall.png"} style={{
                                                        width: '20px'
                                                    }}/>
                                                    <Typography variant="caption" style={{
                                                        marginLeft: '5px'
                                                    }}>{nat.label} {nat.network.ip.city}</Typography>
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
                    }) : <Typography variant="caption">No peer has this image</Typography>
                }
            </List>
        );
    }
}

export default withStyles(styles)(OwnersList);