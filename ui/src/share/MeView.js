import React, {Component} from 'react';
import PropTypes from 'prop-types';

import {withStyles} from '@material-ui/core/styles';

import ExpansionPanel from '@material-ui/core/ExpansionPanel';
import ExpansionPanelSummary from '@material-ui/core/ExpansionPanelSummary';
import ExpansionPanelDetails from '@material-ui/core/ExpansionPanelDetails';
import Typography from '@material-ui/core/Typography';
import ExpandMoreIcon from '@material-ui/icons/ExpandMore';

import Paper from "@material-ui/core/Paper";
import AccountCircleRounded from '@material-ui/icons/AccountCircleRounded';
import TextField from "@material-ui/core/TextField";
import _ from "lodash";

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

class MeView extends Component {

    constructor(props) {
        super(props);

        this.master = props.master;
        const emitter = this.master.emitter;

        this.state = {
            expandedMe: false,
            showMe: true,
            me: {}, myNat: null, connectionType: ''
        };

        props.master.emitter.on('networkTopology', data => {

            if(!props.master.client) return;

            const me = data.nodes
                .find(item => item.networkType === 'client'
                    && item.peerId === props.master.client.peerId);

            const myEdgeNat = data.edges
                .find(item => {
                    const edgePeer = item.from.split('/')[1];
                    return item.networkType === 'nat' && edgePeer === props.master.client.peerId;
                });
            const myNat = myEdgeNat ? data.nodes.find(node => node.id === myEdgeNat.to) : null;

            this.setState({
                me: me ? me : {},
                myNat: myNat
            });
        });

        props.master.emitter.on('localNetwork', chain => {

            const me = chain
                .find(item => item.typeDetail === 'host');

            if(me) {
                me.label = this.state.originPlatform + ' ' + me.ip;
            }
            const myNat = chain
                .find(item => item.typeDetail.includes('srflx') || item.typeDetail.includes('prflx'));
            if(myNat) {
                myNat.label = myNat.typeDetail + ' ' + myNat.ip;
                myNat.network = {
                    ip: {
                        city: ''
                    }
                }
            }

            this.setState({
                me: me ? me : {},
                myNat: myNat
            });
        });

        props.master.emitter.on('connectionType', type => {
            this.setState({
                connectionType: type + ' '
            });
        });

        props.master.emitter.on('addPeerDone', peer => {

            this.setState({
                originPlatform: this.slimPlatform(peer.originPlatform),
                me: {label: this.slimPlatform(peer.originPlatform)}
            });
        });

        emitter.on('showMe', value => {
            this.setState({showMe: value});
        });
    }

    slimPlatform(platform) {
        let slimmed = platform.replace(' Windows ', ' Win ');

        let index, extract;
        index = slimmed.indexOf('Chrome Mobile');
        if(index > -1) {
            extract = slimmed.slice(index + 16, index + 26);
            slimmed = platform.replace(extract, '');
        } else if(slimmed.indexOf('Chrome ') > -1) {
            index = slimmed.indexOf('Chrome ');
            extract = slimmed.slice(index + 9, index + 19);
            slimmed = platform.replace(extract, '');
        }

        return slimmed;
    }

    handleExpand = panel => (event, expanded) => {
        this.setState({
            [panel]: expanded,
        });
    };

    batchChangeName(event) {

        if(!event.target) return;

        console.log('change name ' + event.target.value);
        this.master.service.updatePeer(this.master.client.peerId, {
            name: event.target.value
        });
    }

    buildNameEntry() {
        const init = this.master && this.master.client && this.master.client.peerId && this.master.me;
        return init ? <span style={{
            display: 'flex',
            flexDirection: 'row',
            alignItems: 'center'
        }}><TextField
            placeholder="Your Nickname"
            margin="normal"
            variant="outlined"
            defaultValue={this.master.me.name}
            onClick={event => {
                event.stopPropagation();
            }}
            onChange={
                this.batchChangeName.bind(this)
                //_.debounce(this.batchChangeName.bind(this), 2000)
            }
        /></span> : '';
    }

    render() {

        const { classes } = this.props;
        const {expandedMe, showMe, me, myNat, connectionType} = this.state;

        return (
            showMe ? <span>
                <ExpansionPanel expanded={expandedMe} onChange={this.handleExpand('expandedMe')}>
                    <ExpansionPanelSummary expandIcon={<ExpandMoreIcon />}>
                        {this.buildNameEntry()}
                    </ExpansionPanelSummary>
                    <ExpansionPanelDetails className={classes.content}>
                        <div className={classes.verticalAndWide}>
                            <Paper style={{
                                margin: '10px',
                                padding: '10px'}}>
                                <div
                                    className={classes.vertical}>
                                    <span
                                        className={classes.horizontal}>
                                        <AccountCircleRounded/>
                                        <Typography variant="caption" style={{
                                            marginLeft: '5px'
                                        }}>{connectionType}{me.label}</Typography>
                                    </span>
                                    {myNat ? <span
                                        className={classes.horizontal}>
                                        <img src={"./firewall.png"} style={{
                                            width: '20px'
                                        }}/>
                                        <Typography variant="caption" style={{
                                            marginLeft: '5px'
                                        }}>{myNat.label} {myNat.network.ip.city}</Typography>
                                    </span> : ''}
                                </div>
                            </Paper>
                        </div>
                </ExpansionPanelDetails>
                </ExpansionPanel>
            </span> : ''
        );
    }
}

MeView.propTypes = {
    classes: PropTypes.object.isRequired,
    master: PropTypes.object.isRequired,
};

export default withStyles(styles)(MeView);