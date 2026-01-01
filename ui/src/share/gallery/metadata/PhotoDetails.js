import React, { Component } from 'react';
import PropTypes from 'prop-types';

import Dialog from '@mui/material/Dialog';
import DialogContent from '@mui/material/DialogContent';
import DialogTitle from '@mui/material/DialogTitle';
import DialogActions from '@mui/material/DialogActions';
import CloseRounded from '@mui/icons-material/CloseRounded';

import List from '@mui/material/List';
import { withStyles } from '@mui/styles';
import PhotoDetailsRenderer from "./PhotoDetailsRenderer";
import IconButton from "@mui/material/IconButton";
import MetadataParser from "./MetadataParser";
import Slide from '@mui/material/Slide';
import FileUtil from "../../util/FileUtil";
import Logger from 'js-logger';

const Transition = React.forwardRef(function Transition(props, ref) {
    return <Slide direction="up" ref={ref} {...props} />;
});

const styles = theme => ({
    root: {
        width: '100%',
        backgroundColor: theme.palette.background.paper,
    },
});

class PhotoDetails extends Component {

    constructor(props) {
        super(props);
        this.state = {
            fileName: FileUtil.getFileNameWithoutSuffix(props.tile.fileName)
        }
    }

    componentDidMount() {
        this.setState((state, props) => {
            return {fileName: FileUtil.getFileNameWithoutSuffix(props.tile.fileName)}
        });
    }

    componentDidUpdate(nextProps) {
        const { tile, open } = this.props;
        const fileName = tile.fileName;
        if (nextProps.tile.fileName !== fileName) {
            if (fileName) {
                this.setState({ fileName: fileName })
            }
        }
        if (!nextProps.open && open && tile.metadata) {
            this.setState((state, props) => {
                if(tile.metadata) {
                    const summaryMetadata = props.parser.createMetadataSummary(tile.metadata, tile);
                    return {metadata: summaryMetadata, fileName: FileUtil.getFileNameWithoutSuffix(tile.fileName)};
                } else {
                    return {fileName: FileUtil.getFileNameWithoutSuffix(tile.fileName)};
                }
            });
        }
    }

    render() {
        const {master, classes, tile, open} = this.props;
        const {metadata, fileName} = this.state;

        const details = new PhotoDetailsRenderer(master.service, this);
        const metadataList = details.render(metadata, tile, fileName);

        return (
            <div className={classes.root}>
                <Dialog
                    fullScreen={true}
                    TransitionComponent={Transition}
                    open={open}
                    onClose={() => this.handleClose()}
                    aria-labelledby="alert-dialog-title"
                    aria-describedby="alert-dialog-description"
                >
                    <DialogTitle id="alert-dialog-title">{"All that metadata"}</DialogTitle>
                    <DialogActions>
                        <IconButton
                            onClick={() => this.props.handleClose()}
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