import React, { Component } from 'react';
import {withStyles} from '@mui/styles';
import Typography from "@mui/material/Typography";
import StringUtil from "./StringUtil";

const styles = theme => ({
    horizontal: {
        display: 'flex',
        flexDirection: 'row',
        alignItems: 'center',
        justifyContent: 'center'
    },
});

class NatListItem extends Component {

    constructor(props) {
        super(props);
    }

    render() {

        const {nat, classes} = this.props;

        return (
            nat ? <span
                    className={classes.horizontal} style={{
                    justifyContent: 'left', width: '100%'
                }}>
                    <img src={"./firewall.png"} alt="firewall" style={{
                        width: '20px', marginLeft: '2px'
                    }}/>
                    <Typography variant="caption" style={{
                        marginLeft: '7px', textAlign: 'left'
                    }}>{StringUtil.createNetworkLabel(nat)}</Typography>
                </span> : ''
        );
    }
}

export default withStyles(styles)(NatListItem);