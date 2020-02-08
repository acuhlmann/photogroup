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
import Slide from '@material-ui/core/Slide';
import FileUtil from "../util/FileUtil";

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
            parser: new MetadataParser(),
            fileName: FileUtil.getFileNameWithoutSuffix(props.tile.fileName)
        }
    }

    componentDidMount() {
        const {tile, master} = this.props;
        const {parser} = this.state;

        this.setState((state, props) => {
            return {fileName: FileUtil.getFileNameWithoutSuffix(props.tile.fileName)}
        });
        parser.readMetadata(tile, async (tile, metadata) => {

            this.setState((state, props) => {
                const summaryMetadata = state.parser.createMetadataSummary(metadata);
                return {metadata: summaryMetadata, fileName: FileUtil.getFileNameWithoutSuffix(props.tile.fileName)}
            });

            if(tile.seed) {

                const photo = {
                    infoHash: tile.infoHash,
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

    componentDidUpdate(nextProps) {
        const { tile } = this.props;
        const fileName = tile.fileName;
        if (nextProps.tile.fileName !== fileName) {
            if (fileName) {
                this.setState({ fileName: fileName })
            }
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