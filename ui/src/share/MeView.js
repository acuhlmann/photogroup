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
            expandedMe: true,
            showMe: true,
            me: {}, myNat: {}
        };

        props.master.emitter.on('networkTopology', data => {

            if(!props.master.client) return;

            const me = data.nodes
                .find(item => item.networkType === 'client'
                    && item.peerId === props.master.client.peerId);

            const myEdgeNat = data.edges
                .find(item => item.networkType === 'nat');
            const myNat = myEdgeNat ? data.nodes.find(node => node.id === myEdgeNat.to) : null;

            this.setState({
                me: me ? me : {},
                myNat: myNat ? myNat : {}
            });
        });

        emitter.on('showMe', value => {
            this.setState({showMe: value});
        });
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
            placeholder="Your Name"
            margin="normal"
            variant="outlined"
            defaultValue={this.master.me.name}
            onChange={
                _.debounce(this.batchChangeName.bind(this), 2000, { 'leading': true })
            }
        /></span> : '';
    }

    render() {

        const { classes } = this.props;
        const {expandedMe, showMe, me, myNat} = this.state;

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
                                        <img src={"./firewall.png"} style={{
                                            width: '20px'
                                        }}/>
                                        <Typography variant="caption" style={{
                                            marginLeft: '5px'
                                        }}>{myNat.label}</Typography>
                                    </span>
                                    <span
                                        className={classes.horizontal}>
                                        <AccountCircleRounded/>
                                        <Typography variant="caption" style={{
                                            marginLeft: '5px'
                                        }}>{me.label}</Typography>
                                    </span>
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