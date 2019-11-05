import React, { Component } from 'react';
import PropTypes from 'prop-types';

import Dialog from '@material-ui/core/Dialog';
import DialogContent from '@material-ui/core/DialogContent';
import DialogTitle from '@material-ui/core/DialogTitle';
import DialogActions from '@material-ui/core/DialogActions';
import CloseRounded from '@material-ui/icons/CloseRounded';

import List from '@material-ui/core/List';
import { withStyles } from '@material-ui/core/styles';
import PhotoDetailsRenderer from "./PhotoDetailsRenderer";
import IconButton from "@material-ui/core/IconButton";

const styles = theme => ({
    root: {
        width: '100%',
        backgroundColor: theme.palette.background.paper,
    },
});

class PhotoDetails extends Component {

    constructor(props) {
        super(props);

        const { classes } = props;
        this.classes = classes;
    }

    handleClose() {
        this.props.handleClose();
    }

    render() {
        const classes = this.classes;

        const metadataList = PhotoDetailsRenderer.render(
            this.props.metadata,
            this.props.sharedBy,
            this.props.fileSize);

        return (
            <div className={classes.root}>
                <Dialog
                    fullScreen={true}
                    open={this.props.open}
                    onClose={this.handleClose.bind(this)}
                    aria-labelledby="alert-dialog-title"
                    aria-describedby="alert-dialog-description"
                >
                    <DialogTitle id="alert-dialog-title">{"All that Image Metadata"}</DialogTitle>
                    <DialogActions>
                        <IconButton
                            onClick={this.handleClose.bind(this)}
                        >
                            <CloseRounded />
                        </IconButton>
                    </DialogActions>
                    <DialogContent>
                        <List>
                            {metadataList}
                        </List>
                    </DialogContent>
                </Dialog>
            </div>
        );
    }
}

PhotoDetails.propTypes = {
    classes: PropTypes.object.isRequired,
};

export default withStyles(styles)(PhotoDetails);