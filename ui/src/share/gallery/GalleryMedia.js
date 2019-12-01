import React, { Component } from 'react';
import {withStyles} from '@material-ui/core/styles';
import PropTypes from 'prop-types';

import IconButton from '@material-ui/core/IconButton';
import InfoIcon from '@material-ui/icons/Info';
import DeleteIcon from '@material-ui/icons/Delete';
import CloudUploadIcon from '@material-ui/icons/CloudUpload';
import CloudDownloadIcon from '@material-ui/icons/CloudDownload';
import Button from "@material-ui/core/Button/Button";
import Typography from "@material-ui/core/Typography";
import Paper from "@material-ui/core/Paper";
import { withSnackbar } from 'notistack';
import download from 'downloadjs';

import Logger from 'js-logger';
import FileUtil from '../util/FileUtil';
import PhotoDetails from './PhotoDetails';

const styles = theme => ({
    icon: {
        //color: 'rgba(255, 255, 255, 0.54)',
    },
    toolbar: {
        display: 'flex',
        alignItems: 'center',
        flexWrap: 'wrap',
        padding: '5px',
    },
    white: {
        color: '#ffffff'
    },
    wordwrap: {
        wordWrap: 'break-word'
    },
    cardContent: {
        width: '100%',
        alignItems: 'left',
        justifyContent: 'left',
        //textAlign: 'left'
    },
    wide: {
        width: '100%',
    },
});

class GalleryMedia extends Component {

    constructor(props) {
        super(props);

        this.master = props.master;
        this.model = props.model;

        this.ref = React.createRef();

        this.state = {
            open: false,
            allMetadata: [],
            sharedBy: {},
            fileSize: '',
        };
    }

    handleImageLoaded(tile, index, img) {
        this.model.parser.readMetadata(tile, index, img, async tile => {

            if(tile.seed) {

                const url = {
                    hash: tile.torrent.infoHash,
                    url: tile.torrent.magnetURI,
                    secure: tile.secure,
                    peerId: tile.sharedBy.peerId,
                    fileSize: tile.size,
                    fileName: tile.fileName,
                    picDateTaken: tile.dateTaken,
                    picTitle: tile.title,
                    picDesc: tile.desc,
                    picSummary: tile.summary,
                    cameraSettings: tile.cameraSettings,
                };

                await this.master.service.share(url);
                //console.log('shared ' + shared);
                await this.master.findExistingContent(this.master.service.find);
            }
        });
    }

    handleOpen(tile) {
        this.setState({
            open: true,
            url: this.master.urls.find(item => item.url === tile.torrent.magnetURI),
            allMetadata: this.model.parser.createMetadataSummary(tile.allMetadata),
            sharedBy: tile.sharedBy,
            fileSize: tile.size
        });
    }

    handleClose() {
        this.setState({ open: false });
    }

    downloadFromServer(tile) {
        Logger.log('downloadFromServer ' + tile.name);
        const url = this.master.urls.find(item => item.url === tile.torrent.magnetURI);
        const name = url && url.fileName ? url.fileName + FileUtil.getFileSuffix(tile.name) : tile.name;
        download(tile.elem, name);
    }

    addServerPeer(tile, action) {

        Logger.log(tile.torrent.magnetURI);

        const self = this;
        this.master.service.addServerPeer(tile.torrent.magnetURI).then(result => {

            self.master.emitter.emit('appEventRequest', {level: 'warning', type: 'serverPeer',
                event: {action: action, sharedBy: tile.sharedBy}
            });
            Logger.log('Shared server peer ' + result.url);

        }).catch(err => {

            Logger.log('addServerPeer already added? ' + err);

            self.props.enqueueSnackbar('Image already shared with photogroup.network', {
                variant: 'error',
                autoHideDuration: 6000,
                action: <Button className={self.props.classes.white} size="small">x</Button>
            });
        });
    }

    handleDelete(tile) {
        this.model.deleteTile(tile);
        //this.master.service.delete(url.hash);
    }

    componentDidMount() {
        this.handleContainerLoaded(this.props.tile, this.ref.current);
    }

    handleContainerLoaded(tile, node) {
        if(!tile || !node) return;

        const opts = {
            autoplay: true,
            muted: true, loop: true
        };
        const self = this;
        tile.torrent.files[0].appendTo(node, opts, (err, elem) => {
            if (err) Logger.error('webtorrent.appendTo ' + err.message); // file failed to download or display in the DOM
            console.log('New DOM node with the content', elem);
            if(elem && elem.style) {
                elem.style.width = '100%';
                elem.style.height = '100%';
            }

            if(tile.isVideo) {
                elem.loop = true;
            }
            self.handleImageLoaded(tile, self.props.index, elem);
        });
    }

    render() {
        const {classes, tile, label} = this.props;

        return (
            <div>
                <div cols={tile.cols || 1} className={classes.gridList}>
                    <div className={classes.wide} ref={this.ref}>
                    </div>
                    <Paper className={classes.toolbar}>

                        <div style={{width: '100%'}}>
                            <IconButton onClick={this.downloadFromServer.bind(this, tile)}>
                                <CloudDownloadIcon/>
                            </IconButton>
                            <IconButton onClick={this.handleOpen.bind(this, tile)} className={classes.icon}>
                                <InfoIcon />
                            </IconButton>
                            <Typography onClick={this.handleOpen.bind(this, tile)} className={classes.wordwrap}
                                        title={tile.summary}
                                        variant="caption">{tile.summary} {tile.size} {tile.cameraSettings}
                            </Typography>
                        </div>
                        <div className={classes.cardContent}>
                            <Typography variant={"caption"}>first shared by {tile.sharedBy.originPlatform}</Typography>
                            <IconButton onClick={this.addServerPeer.bind(this, tile, label)}>
                                <CloudUploadIcon/>
                            </IconButton>
                            <IconButton onClick={this.handleDelete.bind(this, tile)}
                                        className={classes.icon}>
                                <DeleteIcon />
                            </IconButton>
                        </div>
                    </Paper>
                </div>
                <PhotoDetails metadata={this.state.allMetadata}
                                sharedBy={this.state.sharedBy}
                                fileSize={this.state.fileSize}
                                open={this.state.open}
                                url={this.master.urls.find(item => item.url === tile.torrent.magnetURI)}
                                service={this.master.service}
                                handleClose={this.handleClose.bind(this)} />
            </div>
        );
    }
}

GalleryMedia.propTypes = {
    tile: PropTypes.object.isRequired,
    index: PropTypes.number.isRequired,
    label: PropTypes.string.isRequired,
    model: PropTypes.object.isRequired,
    master: PropTypes.object.isRequired,
};

export default withSnackbar(withStyles(styles)(GalleryMedia));