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
import update from "immutability-helper";
import ViewListRounded from '@material-ui/icons/ViewListRounded';
import ViewAgendaRounded from '@material-ui/icons/ViewAgendaRounded';
import IconButton from '@material-ui/core/IconButton';

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
    },
});

class MeView extends Component {

    constructor(props) {
        super(props);

        this.master = props.master;
        const emitter = this.master.emitter;

        this.state = {
            expandedMe: false,
            showMe: true,
            me: {}, myNat: null, connectionSpeedType: ''
        };

        emitter.on('localNetwork', chain => {

            //if(this.master.service.hasRoom) return;
            const me = chain
                .find(item => item.typeDetail === 'host');

            if(me) {
                me.label = this.state.originPlatform + ' ' + me.ip;
            }
            const myNat = this.findNat(chain);
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

        emitter.on('peers', event => {

            if(event.type === 'update') {
                const myPeer = event.item;
                if(myPeer && myPeer.peerId === this.master.client.peerId && myPeer.networkChain) {
                    const myNat = this.findNat(myPeer.networkChain);
                    if(myNat && !myNat.network) {
                        myNat.network = {
                            ip: {
                                city: ''
                            }
                        }
                    }
                    myNat.label = myNat.typeDetail + ' ' + (myNat.network.hostname || myNat.ip);
                    const me = myPeer.networkChain.find(item => item.typeDetail === 'host');
                    if(me) {
                        me.label = this.state.originPlatform + ' ' + me.ip;
                    }
                    this.setState({
                        myNat: myNat,
                        me: me ? me : {},
                    });
                }
            }
        });

        emitter.on('connectionSpeedType', type => {
            this.setState({
                connectionSpeedType: type + ' '
            });
        });

        emitter.on('addPeerDone', peer => {

            this.setState({
                originPlatform: this.slimPlatform(peer.originPlatform),
                me: {label: this.slimPlatform(peer.originPlatform)},
            });
        });

        emitter.on('showMe', value => {
            this.setState({showMe: value});
        });
    }

    findNat(chain) {
        return chain
            .find(item => item.typeDetail.includes('srflx') || item.typeDetail.includes('prflx'));
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
        this.master.service.updatePeer({
            name: event.target.value
        });
    }

    buildHeader(classes) {
        const init = this.master && this.master.client && this.master.client.peerId && this.master.me;
        return init ? <span style={{
            display: 'flex',
            flexDirection: 'row',
            alignItems: 'center',
            justifyContent: 'space-between',
            width: '100%'
        }}>
            <TextField
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
            />
            <span className={classes.horizontal}>
                <IconButton
                        onClick={(event) => {
                            event.stopPropagation();
                            this.master.emitter.emit('galleryListView');
                        }}>
                    <ViewListRounded />
                </IconButton>
                <IconButton
                        onClick={(event) => {
                            event.stopPropagation();
                            this.master.emitter.emit('galleryImageView');
                        }}>
                    <ViewAgendaRounded />
                </IconButton>
            </span>
        </span> : '';
    }

    render() {

        const { classes } = this.props;
        const {expandedMe, showMe, me, myNat, connectionSpeedType} = this.state;

        return (
            showMe ? <span>
                <ExpansionPanel expanded={expandedMe} onChange={this.handleExpand('expandedMe')}>
                    <ExpansionPanelSummary expandIcon={<ExpandMoreIcon />}>
                        {this.buildHeader(classes)}
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
                                        }}>{connectionSpeedType}{me.label}</Typography>
                                    </span>
                                    {myNat ? <span
                                        className={classes.horizontal}>
                                        <img src={"./firewall.png"} alt="firewall" style={{
                                            width: '20px'
                                        }}/>
                                        <Typography variant="caption" style={{
                                            marginLeft: '5px'
                                        }}>{myNat.label} {myNat.network.city}</Typography>
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