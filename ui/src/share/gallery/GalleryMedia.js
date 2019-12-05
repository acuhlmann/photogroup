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

        //this.ref = React.createRef();

        this.state = {
            open: false,
            allMetadata: [],
            sharedBy: {},
            fileSize: '',
            //tile: props.tile,
            ref: React.createRef(),
            elem: null,
            tile: props.tile
        };
    }

    handleImageLoaded(tile, img) {
        this.model.parser.readMetadata(tile, img, async tile => {

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

        this.setState((state, props) => ({
            open: true,
            url: props.master.urls.find(item => item.url === tile.torrent.magnetURI),
            allMetadata: props.model.parser.createMetadataSummary(tile.allMetadata),
            sharedBy: tile.sharedBy,
            fileSize: tile.size
        }));
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

    async handleDelete(tile) {
        //this.componentWillUnmount();
        const hash = await this.model.deleteTile(tile);
        Logger.log('handleDelete ' + tile.torrent.name + ' ' + hash + ' ' + tile.torrent.infoHash);
        //this.master.service.delete(tile.torrent.infoHash);
    }

    componentDidMount() {

        //this.handleImageLoaded(this.state.tile, null);

        //this.ref = React.createRef();
        this.handleContainerLoaded(this.props.tile, this.state.ref.current, this.props.file);
        //this.forceUpdate();
    }
    /*
    componentWillUnmount() {
        //this.forceUpdate();
        const node = this.state.ref.current;
        if(!node || !node.firstChild) return;
        Logger.info('componentWillUnmount ' + node.firstChild.alt);
        //while (node.firstChild) {
        //    node.removeChild(node.firstChild);
        //}
        //this.forceUpdate();
        //this.ref = React.createRef();

        //node.removeChild(this.state.elem);
    }*/

    handleContainerLoaded(tile, node, file) {
        if(!tile || !node || !file || node.hasChildNodes()) return;

        Logger.info('handleContainerLoaded ' + tile.torrent.name);
        const opts = {
            autoplay: true,
            muted: true, loop: true
        };
        const self = this;
        file.appendTo(node, opts, (err, elem) => {
            // file failed to download or display in the DOM
            if (err) {
                Logger.error('webtorrent.appendTo ' + err.message);
                self.props.enqueueSnackbar(err.message, {
                    variant: 'error',
                    autoHideDuration: 6000,
                    action: <Button className={self.props.classes.white} size="small">x</Button>
                });
            }

            console.log('New DOM node with the content', elem);
            if(elem && elem.style) {
                elem.style.width = '100%';
                elem.style.height = '100%';
            }

            if(tile.isVideo) {
                elem.loop = true;
            }
            self.handleImageLoaded(tile, elem);
            self.setState({elem: elem});
        });
    }

    render() {
        const {classes, label, name} = this.props;
        const {open, url, ref, tile} = this.state;
        //{this.handleContainerLoaded(tile, this.ref.current)}

        return (
            <div>
                <div cols={tile.cols || 1} className={classes.gridList}>
                    <div className={classes.wide} ref={ref}>

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
                                        variant="caption">{name}
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
                              open={open}
                              url={url}
                              service={this.master.service}
                              handleClose={this.handleClose.bind(this)} />
            </div>
        );
    }
}

GalleryMedia.propTypes = {
    tile: PropTypes.object.isRequired,
    label: PropTypes.string.isRequired,
    model: PropTypes.object.isRequired,
    master: PropTypes.object.isRequired,
};

export default withSnackbar(withStyles(styles)(GalleryMedia));