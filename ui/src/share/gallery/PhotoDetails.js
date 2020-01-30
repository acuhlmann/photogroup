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
import MetadataParser from "./MetadataParser";

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
            details: new PhotoDetailsRenderer(props.master.service),
            parser: new MetadataParser()
        }
    }

    componentDidMount() {
        const {tile, master} = this.props;
        const {parser} = this.state;

        const self = this;
        parser.readMetadata(tile, async (tile, metadata) => {

            const summaryMetadata = parser.createMetadataSummary(metadata);
            self.setState({metadata: summaryMetadata});

            if(tile.seed) {

                const photo = {
                    infoHash: tile.torrent.infoHash,
                    url: tile.torrent.magnetURI,
                    peerId: tile.peerId,
                    fileSize: tile.fileSize,
                    fileName: tile.fileName,
                    //metadata
                    picDateTaken: tile.picDateTaken,
                    picTitle: tile.picTitle,
                    picDesc: tile.picDesc,
                    picSummary: tile.picSummary,
                    cameraSettings: tile.cameraSettings,
                };

                const result = await master.service.share(photo);
                console.log('master.service.share(photo) ' + result);
            }
        });
    }

    render() {
        const {classes, tile, open} = this.props;
        const {details, metadata} = this.state;

        const metadataList = details.render(metadata, tile);

        return (
            <div className={classes.root}>
                <Dialog
                    fullScreen={true}
                    open={open}
                    onClose={() => this.handleClose()}
                    aria-labelledby="alert-dialog-title"
                    aria-describedby="alert-dialog-description"
                >
                    <DialogTitle id="alert-dialog-title">{"All that Image Metadata"}</DialogTitle>
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