import React, { Component } from 'react';
import {withStyles} from '@material-ui/core/styles';
import Typography from "@material-ui/core/Typography";
import List from "@material-ui/core/List";
import ListItem from "@material-ui/core/ListItem";
import AccountCircleRounded from "@material-ui/icons/AccountCircleRounded";

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
    }

    render() {
        const {classes, owners, master, tile} = this.props;

        const connections = [];
        return (
            <List>
                {
                    owners.length > 0 ? owners.map((owner, index) => {
                        let connection;
                        if(connections && connections.length > 0) {
                            const firstConnection = connections.filter(item => item.infoHash === item.infoHash);
                            connection = firstConnection.find(item => item.fromPeerId === owner.peerId
                                || item.toPeerId === owner.peerId);
                        }
                        const myEdgeNat = allEdges
                            .find(item => {
                                const edgePeer = item.from.split('/')[1];
                                return item.networkType === 'nat' && edgePeer === owner.peerId;
                            });
                        const nat = myEdgeNat ? allNats.find(node => node.id === myEdgeNat.to) : null;
                        const peer = otherPeers.find(item => item.peerId === owner.peerId);
                        return peer ? <ListItem key={index}>
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
                                                }}>{peer.label}</Typography>
                                            </span>
                                        </span>
                        </ListItem> : '';
                    }) : <Typography variant="caption">No peer has this image</Typography>
                }
            </List>
        );
    }
}

export default withStyles(styles)(OwnersList);