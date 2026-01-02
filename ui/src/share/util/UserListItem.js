import React from 'react';
import {withStyles} from '@mui/styles';
import Typography from "@mui/material/Typography";
import StringUtil from "./StringUtil";
import AccountCircleRounded from "@mui/icons-material/AccountCircleRounded";

const styles = theme => ({
    horizontal: {
        display: 'flex',
        flexDirection: 'row',
        alignItems: 'center',
        justifyContent: 'center'
    },
});

function UserListItem({peer, classes}) {
    const createClientLabel = (peer) => {
        return StringUtil.addEmptySpaces([
            peer.connectionSpeedType,
            peer.name,
            peer.originPlatform
        ]);
    };

    return (
        <span
            className={classes.horizontal}
            style={{
                justifyContent: 'left'
            }}>
            <AccountCircleRounded/>
            <Typography variant="caption" style={{
                marginLeft: '5px', 
                textAlign: 'left'
            }}>
                {createClientLabel(peer)}
            </Typography>
        </span>
    );
}

export default withStyles(styles)(UserListItem);