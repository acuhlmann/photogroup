import React, { useState, useEffect, useRef } from 'react';
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

function PhotoDetails({master, classes, tile, open, parser, handleClose}) {
    const [fileName, setFileName] = useState(() => FileUtil.getFileNameWithoutSuffix(tile.fileName));
    const [metadata, setMetadata] = useState(null);
    const componentRef = useRef(null);

    useEffect(() => {
        setFileName(FileUtil.getFileNameWithoutSuffix(tile.fileName));
    }, [tile.fileName]);

    useEffect(() => {
        if (!open && tile.metadata) {
            if (tile.metadata) {
                const summaryMetadata = parser.createMetadataSummary(tile.metadata, tile);
                setMetadata(summaryMetadata);
                setFileName(FileUtil.getFileNameWithoutSuffix(tile.fileName));
            } else {
                setFileName(FileUtil.getFileNameWithoutSuffix(tile.fileName));
            }
        }
    }, [open, tile, parser]);

    const details = new PhotoDetailsRenderer(master.service, componentRef.current);
    const metadataList = details.render(metadata, tile, fileName);

    return (
        <div className={classes.root} ref={componentRef}>
            <Dialog
                fullScreen={true}
                TransitionComponent={Transition}
                open={open}
                onClose={handleClose}
                aria-labelledby="alert-dialog-title"
                aria-describedby="alert-dialog-description"
            >
                <DialogTitle id="alert-dialog-title">{"All that metadata"}</DialogTitle>
                <DialogActions>
                    <IconButton onClick={handleClose}>
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

PhotoDetails.propTypes = {
    classes: PropTypes.object.isRequired,
};

export default withStyles(styles)(PhotoDetails);