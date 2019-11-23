import React, { Component } from 'react';
import PropTypes from 'prop-types';

import GridListTile from '@material-ui/core/GridListTile';
import IconButton from '@material-ui/core/IconButton';
import InfoIcon from '@material-ui/icons/Info';
import DeleteIcon from '@material-ui/icons/Delete';
import CloudUploadIcon from '@material-ui/icons/CloudUpload';
import CloudDownloadIcon from '@material-ui/icons/CloudDownload';
import ClearIcon from '@material-ui/icons/Delete';

import { withStyles } from '@material-ui/core/styles';

import PhotoDetails from './PhotoDetails';
import Button from "@material-ui/core/Button/Button";
import Typography from "@material-ui/core/Typography";
import PasswordInput from "../security/PasswordInput";
import Paper from "@material-ui/core/Paper";

import Logger from "js-logger";
import {withSnackbar} from "notistack";
import download from 'downloadjs';
import FileUtil from "../util/FileUtil";

const styles = theme => ({
    root: {
        display: 'flex',
        flexWrap: 'wrap',
        justifyContent: 'space-around',
        //overflow: 'hidden',
        width: '100%',
        backgroundColor: theme.palette.background.paper,
    },
    gridList: {
        //overflow: 'hidden',
        width: '100%',
        paddingBottom: '10px'
    },
    wide: {
        width: '100%',
    },
    icon: {
        //color: 'rgba(255, 255, 255, 0.54)',
    },
    toolbar: {
        display: 'flex',
        alignItems: 'center',
        flexWrap: 'wrap',
        padding: '5px',
    },

    cardContent: {
        width: '100%',
        alignItems: 'left',
        justifyContent: 'left',
        //textAlign: 'left'
    },
    card: {
        margin: theme.spacing(1),
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'center',
        flexDirection: 'column',
    },
    item: {
        //display: 'flex',
        //alignItems: 'center',
        //justifyContent: 'left',
        //flexDirection: 'row',
    },
    white: {
        color: '#ffffff'
    },
    wordwrap: {
        wordWrap: 'break-word'
    }
});

class Gallery extends Component {

    constructor(props) {
        super(props);

        this.master = props.master;
        this.model = props.model;
        this.model.view = this;

        this.state = {
            open: false,
            tileData: [],
            allMetadata: [],
            sharedBy: {},
            fileSize: '',
            urls: []
        };

        this.master.emitter.on('urls', urls => {

            this.setState({
                urls: urls,
                tileData: this.state.tileData.map(tile => {

                    const url = urls.find(item => item.url === tile.torrent.magnetURI);

                    if(url && url.fileName && tile.allMetadata) {
                        const allMetadata = this.model.parser.createMetadataSummary(tile.allMetadata);
                        const suffix = FileUtil.getFileSuffix(tile.torrent.name);
                        tile.summary = this.model.parser.createSummary(allMetadata, tile.dateTaken, url.fileName + suffix);
                    }
                    return tile;
                })
            });
        });

        const { classes } = props;
        this.classes = classes;
    }

    handleImageLoaded(tile, event) {
        this.model.parser.readMetadata(tile, event, async tile => {

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

    handleDelete(tile) {
        this.model.deleteTile(tile);
        //this.master.service.delete(url.hash);
    }

    handleOpen(tile) {
        this.setState({
            open: true,
            allMetadata: this.model.parser.createMetadataSummary(tile.allMetadata),
            url: this.state.urls.find(item => item.url === tile.torrent.magnetURI),
            sharedBy: tile.sharedBy,
            fileSize: tile.size
        });
    }

    handleClose() {
        this.setState({ open: false });
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

    removeServerPeer(tile, peerId) {
        this.master.service.removeOwner(tile.torrent.infoHash, peerId);
    }

    downloadFromServer(tile) {
        Logger.log('downloadFromServer ' + tile.name);
        const url = this.state.urls.find(item => item.url === tile.torrent.magnetURI);
        const name = url.fileName ? url.fileName + FileUtil.getFileSuffix(tile.name) : tile.name;
        download(tile.elem, name);
    }

    buildTile(tile, index, classes) {

        const master = this.master;

        const label = tile.name + ' of ' + tile.size + ' first shared by ' + tile.sharedBy.originPlatform;

        if(tile.secure) {

            return <GridListTile key={index} cols={tile.cols || 1}>
                <div>Decrypt with</div>
                <PasswordInput onChange={value => this.setState({password: value})} />
                <Button onClick={this.model.decrypt.bind(this.model, tile, this.state.password, index)}
                        color="primary">
                    Submit
                </Button>
            </GridListTile>;
        } else {

            const urlItem = this.state.urls.find(item => item.url === tile.torrent.magnetURI);
            /*let downloadedBy;
            if(urlItem) {
                downloadedBy = <span>
                   <Typography>downloaded by</Typography>
                    <div>
                        {urlItem.owners
                        .map((owner, index) => {

                            const meLabel = owner.peerId === master.client.peerId ? 'me - ' : '';
                            const downloadLabel = meLabel + owner.platform;
                            const clearButton = owner.platform === 'photogroup.network'
                                ? <IconButton onClick={this.removeServerPeer.bind(this, tile, owner.peerId)}>
                                    <ClearIcon/>
                                </IconButton> : '';
                            return <div className={classes.item} key={index}>
                                <Typography
                                    className={classes.wordwrap} variant="caption">{downloadLabel}
                                </Typography>
                                {clearButton}
                            </div>})}
                    </div>
                </span>
            }*/

            return <div key={tile.img} cols={tile.cols || 1} className={classes.gridList}>
                <img id={'img' + index}  src={tile.img} alt={tile.title}
                     crossOrigin="Anonymous" className={classes.wide}
                     onLoad={this.handleImageLoaded.bind(this, tile)} />
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
            </div>;
        }
    }

    render() {
        const classes = this.props.classes;
        const tileData = this.state.tileData;

        return (
            <div className={classes.root}>

                <div className={classes.gridList}>
                    {tileData.map((tile, index) => this.buildTile(tile, index, classes))}
                </div>

                <PhotoDetails metadata={this.state.allMetadata}
                              sharedBy={this.state.sharedBy}
                              fileSize={this.state.fileSize}
                              open={this.state.open}
                              url={this.state.url}
                              service={this.master.service}
                              handleClose={this.handleClose.bind(this)} />
            </div>
        );
    }
}

Gallery.propTypes = {
    classes: PropTypes.object.isRequired,
    model: PropTypes.object.isRequired,
    master: PropTypes.object.isRequired,
};

export default withSnackbar(withStyles(styles)(Gallery));