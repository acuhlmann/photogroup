import React, {Component} from 'react';
import PropTypes from 'prop-types';

import {withStyles} from '@material-ui/core/styles';

import Accordion from '@material-ui/core/Accordion';
import AccordionSummary from '@material-ui/core/AccordionSummary';
import AccordionDetails from '@material-ui/core/AccordionDetails';
import Typography from '@material-ui/core/Typography';
import ExpandMoreIcon from '@material-ui/icons/ExpandMore';

import Paper from "@material-ui/core/Paper";
import AccountCircleRounded from '@material-ui/icons/AccountCircleRounded';
import TextField from "@material-ui/core/TextField";
import update from "immutability-helper";
import ViewListRounded from '@material-ui/icons/ViewListRounded';
import ViewAgendaRounded from '@material-ui/icons/ViewAgendaRounded';
import IconButton from '@material-ui/core/IconButton';
import StringUtil from "./util/StringUtil";
import NatListItem from "./util/NatListItem";
import UserListItem from "./util/UserListItem";
import Slide from "@material-ui/core/Slide";
import {Fade} from "@material-ui/core";

const styles = theme => ({
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

        const expandedMe = localStorage.getItem('expandedMe') || false;
        this.state = {
            expandedMe: String(expandedMe) == 'true',
            showMe: false, galleryHasImages: false, listView: true,
            me: {}, myNat: null, connectionSpeedType: ''
        };
    }

    componentDidMount() {

        const emitter = this.master.emitter;
        emitter.on('localNetwork', chain => {

            //if(this.master.service.hasRoom) return;
            if(this.state.me && this.state.me.label
                && this.state.myNat && this.state.myNat.network && this.state.myNat.network.hostname) return;

            if(!chain.find) return;
            const me = chain
                .find(item => item.typeDetail === 'host');

            if(me) {
                me.label = this.state.originPlatform + ' ' + me.ip;
            }
            const myNat = this.findNat(chain);
            if(myNat) {
                myNat.label = myNat.typeDetail + ' ' + myNat.ip;
                myNat.network = {};
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

                    this.setState(state => {
                        const myNat = this.findNat(myPeer.networkChain);
                        if(myNat && !myNat.network) {
                            myNat.network = {};
                        }
                        if(myNat) {
                            myNat.label = StringUtil.createNetworkLabel(myNat);
                        }
                        const me = myPeer.networkChain.find(item => item.typeDetail === 'host');
                        if(me) {
                            me.label = state.originPlatform + ' ' + me.ip;
                        }
                        return {
                            myNat: myNat,
                            me: me ? me : {},
                        };
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
                originPlatform: StringUtil.slimPlatform(peer.originPlatform),
                me: {label: StringUtil.slimPlatform(peer.originPlatform)},
            });
        });

        emitter.on('showMe', value => {
            this.setState({showMe: value});
        });

        emitter.on('galleryHasImages', hasImages => {
            this.setState({galleryHasImages: hasImages});
        });
    }

    findNat(chain) {
        return chain
            .find(item => item.typeDetail.includes('srflx') || item.typeDetail.includes('prflx'));
    }

    handleExpand = panel => (event, expanded) => {
        localStorage.setItem(panel, expanded);
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

    buildHeader(galleryHasImages, listView, classes) {
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
            <Fade in={galleryHasImages}><span className={classes.horizontal}>
                <IconButton color={listView ? 'primary' : 'inherit'}
                        onClick={(event) => {
                            event.stopPropagation();
                            this.master.emitter.emit('galleryListView', true);
                            this.setState({listView: true});
                        }}>
                    <ViewListRounded />
                </IconButton>
                <IconButton color={!listView ? 'primary' : 'inherit'}
                        onClick={(event) => {
                            event.stopPropagation();
                            this.master.emitter.emit('galleryListView', false);
                            this.setState({listView: false});
                        }}>
                    <ViewAgendaRounded />
                </IconButton>
            </span></Fade>
        </span> : '';
    }

    render() {

        const { classes } = this.props;
        const {expandedMe, showMe, galleryHasImages, listView, me, myNat, connectionSpeedType} = this.state;

        const peer = {
            connectionSpeedType: connectionSpeedType,
            name: '', originPlatform: me.label
        };
        return (
            <Slide direction="left" in={showMe} mountOnEnter unmountOnExit>
                <span>
                    <Accordion expanded={expandedMe} onChange={this.handleExpand('expandedMe')}>
                        <AccordionSummary expandIcon={<ExpandMoreIcon />}>
                            {this.buildHeader(galleryHasImages, listView, classes)}
                        </AccordionSummary>
                        <AccordionDetails className={classes.content}>
                            <div className={classes.verticalAndWide}>
                                <Paper style={{
                                    margin: '10px',
                                    padding: '10px'}}>
                                    <div
                                        className={classes.vertical}>
                                        <UserListItem peer={peer} />
                                        <NatListItem nat={myNat} />
                                    </div>
                                </Paper>
                            </div>
                        </AccordionDetails>
                    </Accordion>
                </span>
            </Slide>
        );
    }
}

MeView.propTypes = {
    classes: PropTypes.object.isRequired,
    master: PropTypes.object.isRequired,
};

export default withStyles(styles)(MeView);