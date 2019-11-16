import React, { Component } from 'react';
import PropTypes from 'prop-types';

import {withStyles } from '@material-ui/core/styles';

import ExpansionPanel from '@material-ui/core/ExpansionPanel';
import ExpansionPanelSummary from '@material-ui/core/ExpansionPanelSummary';
import ExpansionPanelDetails from '@material-ui/core/ExpansionPanelDetails';
import Typography from '@material-ui/core/Typography';
import ExpandMoreIcon from '@material-ui/icons/ExpandMore';

import Paper from "@material-ui/core/Paper";
import CircularProgress from '@material-ui/core/CircularProgress';

import CheckIcon from '@material-ui/icons/CheckRounded';
import ImageIcon from '@material-ui/icons/ImageRounded';
import AccountCircleRounded from '@material-ui/icons/AccountCircleRounded';
import List from '@material-ui/core/List';
import ListItem from '@material-ui/core/ListItem';
import Divider from '@material-ui/core/Divider';
import IconButton from "@material-ui/core/IconButton";
import ClearIcon from '@material-ui/icons/Delete';
import QRCodeView from "./security/QRCodeView";

const styles = theme => ({

    heading: {
        fontSize: theme.typography.pxToRem(15),
        fontWeight: theme.typography.fontWeightRegular,
    },
    content: {
        padding: '0px 0px 0px 0px',
        width: '100%',
        overflow: 'hidden'
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

        this.master = props.master;
        const emitter = this.master.emitter;

        this.state = {
            expandedPeers: true,
            showTopology: false,
            showOtherPeers: true,
            otherPeers: []
        };

        props.master.emitter.on('networkTopology', data => {

            if(!props.master.client) return;

            const allEdges = data.edges;
            const allNats = data.nodes
                .filter(item => item.networkType === 'nat');
            const otherPeers = data.nodes
                .filter(item => item.networkType === 'client'
                    && item.peerId !== props.master.client.peerId)
                .filter(item => {
                    if(item.originPlatform === 'photogroup.network'
                        && item.network && item.network.type !== 'host')
                        return false;
                    else
                        return true;
                });

            this.setState({
                allNats: allNats,
                allEdges: allEdges,
                otherPeers: otherPeers
            });
        });

        emitter.on('urls', urls => {

            this.setState({
                urls: urls
            });
        });

        emitter.on('showOtherPeers', value => {
            this.setState({showOtherPeers: value});
        });
    }

    handleExpand = panel => (event, expanded) => {
        this.setState({
            [panel]: expanded,
        });
    };

    removeServerPeer(hash, peerId) {
        this.master.service.removeOwner(hash, peerId);
    }

    createWhatPeersHave(otherPeers, allNats, allEdges, expandedPeers, classes) {

        return <ExpansionPanel expanded={expandedPeers} onChange={this.handleExpand('expandedPeers')}>
            <ExpansionPanelSummary expandIcon={<ExpandMoreIcon />}>
                <Typography className={classes.heading}>Other Peers</Typography>
            </ExpansionPanelSummary>
            <ExpansionPanelDetails className={classes.content}>
                <div className={classes.verticalAndWide}>
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

                    const myEdgeNat = allEdges.find(item => item.networkType === 'nat');
                    const nat = myEdgeNat ? allNats.find(node => node.id === myEdgeNat.to) : null;
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
                        {nat ? <span
                            className={classes.horizontal}>
                            <img src={"./firewall.png"} style={{
                                width: '20px'
                            }}/>
                            <Typography variant="caption" style={{
                                marginLeft: '5px'
                            }}>{nat.label}</Typography>
                        </span> : ''}
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

        const { classes } = this.props;
        const {expandedPeers, showOtherPeers, otherPeers, allNats, allEdges} = this.state;


        let otherPeersView;
        if(showOtherPeers) {
            otherPeersView = otherPeers.length > 0
                ? this.createWhatPeersHave(otherPeers, allNats, allEdges, expandedPeers, classes)
                : <Typography variant={"body2"}>Currently, there are no other peers.</Typography>;
        }

        return (
            <span>{otherPeersView}</span>
        );
    }
}

OtherPeersView.propTypes = {
    classes: PropTypes.object.isRequired,
    master: PropTypes.object.isRequired,
};

export default withStyles(styles)(OtherPeersView);