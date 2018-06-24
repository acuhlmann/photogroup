import React, { Component } from 'react';
import PropTypes from 'prop-types';

import Dialog from '@material-ui/core/Dialog';
import DialogContent from '@material-ui/core/DialogContent';
import DialogTitle from '@material-ui/core/DialogTitle';
import DialogActions from '@material-ui/core/DialogActions';
import Button from '@material-ui/core/Button';

import List from '@material-ui/core/List';
import ListItem from '@material-ui/core/ListItem';
import ListItemSecondaryAction from '@material-ui/core/ListItemSecondaryAction';
import ListItemText from '@material-ui/core/ListItemText';

import { withStyles } from '@material-ui/core/styles';

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

        const metadataList = this.props.metadata.map((item, index) => (
            <ListItem key={index} dense className={classes.listItem}>
                <ListItemText primary={item.key} />
                <ListItemSecondaryAction>
                    <ListItemText primary={item.value} />
                </ListItemSecondaryAction>
            </ListItem>
        ));
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
                        <Button onClick={this.handleClose.bind(this)} color="primary">
                            Close
                        </Button>
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