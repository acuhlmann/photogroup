import React, { Component } from 'react';
import {withStyles} from '@mui/styles';
import Typography from "@mui/material/Typography";
import Paper from "@mui/material/Paper";
import _ from 'lodash';

import CheckIcon from "@mui/icons-material/CheckRounded";
import ImageIcon from "@mui/icons-material/ImageRounded";
import CircularProgress from "@mui/material/CircularProgress";
import Divider from "@mui/material/Divider";
import OwnersList from "./OwnersList";
import FileUtil from "../util/FileUtil";
import StringUtil from "../util/StringUtil";
import IconButton from "@mui/material/IconButton";
import DeleteIcon from "@mui/icons-material/Delete";
import Logger from "js-logger";
import PiecesLoadingView from "../torrent/PiecesLoadingView";

const styles = theme => ({
    horizontal: {
        display: 'flex',
        flexDirection: 'row',
        alignItems: 'center',
        justifyContent: 'center'
    },
    vertical: {
        display: 'flex',
        flexDirection: 'column'
    },
    wordwrap: {
        wordWrap: 'break-word'
    },
    imageIcon: {
        position: 'relative',
        left: '-10px', top: '-10px'
    },
    progressPercentageText: {
        position: 'relative',
        fontSize: '0.7rem',
        bottom: '26px',
    },
    progressSpeedText: {
        fontSize: '0.7rem',
        wordBreak: 'break-word',
    },
    fabProgress: {
        position: 'absolute',
        zIndex: 1,
        left: '-17px',
        top: '-16px'
    },
    wide: {
        width: '100%',
    },
});

class LoadingTile extends Component {

    constructor(props) {
        super(props);

        this.state = {
            progress: null, timeRemaining: '',
            downSpeed: '', upSpeed: '',
            previewThumbnail: null
        }
    }

    componentDidMount() {
        const emitter = this.props.master.emitter;

        emitter.on('downloadProgress', this.handleDownloadProgress, this);
        emitter.on('uploadProgress', this.handleUploadProgress, this);
        emitter.on('torrentReady', this.listenToPreview, this);
    }

    handleDownloadProgress(event) {
        const torrent = event.torrent;
        if(torrent.infoHash === this.props.tile.infoHash) {
            const progress = event.progress;
            this.setState({
                progress: progress,
                downSpeed: event.speed,
                timeRemaining: event.timeRemaining});
        }
    }

    handleUploadProgress(event) {
        const torrent = event.torrent;
        if(torrent.infoHash === this.props.tile.infoHash) {
            const progress = event.progress;
            this.setState({
                progress: progress,
                upSpeed: event.speed,
                timeRemaining: event.timeRemaining});
        }
    }

    componentWillUnmount() {
        const emitter = this.props.master.emitter;
        emitter.removeListener('downloadProgress', this.handleDownloadProgress, this);
        emitter.removeListener('uploadProgress', this.handleUploadProgress, this);
        emitter.removeListener('torrentReady', this.listenToPreview, this);
    }

    listenToPreview() {
        const {tile} = this.props;
        if(tile.loading && tile.torrentFileThumb) {
            tile.torrentFileThumb.getBlobURL((err, url) => {
                if(err) {
                    Logger.error('preview ' + err);
                }
                this.setState({previewThumbnail: url});
            });
        }
    }

    async handleDelete(tile) {
        const result = await this.props.master.torrentDeletion.deleteItem(tile);
        Logger.info('handleDelete ' + result);
    }

    render() {
        const {tile, master, classes} = this.props;
        let {name} = this.props;

        let {downSpeed, upSpeed, timeRemaining, progress, previewThumbnail} = this.state;

        //progress = 80;
        //downSpeed = '100kb/sec';
        //upSpeed = '0kb/sec';
        //timeRemaining = 'in 1 minute';

        //let owners = tile.owners ? tile.owners : [];
        progress = tile.torrentFile ? Math.round(tile.torrentFile.progress * 100) : progress;
        const progressPercentage = progress ? Math.round(progress) + '%' : progress;
        let have = tile.owners.find(owner => owner.peerId === master.client.peerId && !owner.loading);
        const isLoading = !!progress;
        let loadingText = tile.rendering && !isLoading ? 'Rendering' : (isLoading ? 'Loading' : 'Find Network Path');
        const isRendering = loadingText === 'Rendering';
        if(tile.rendering && !name) {
            const fileSize = _.get(tile, 'file.size');
            if(fileSize && !tile.fileSize) {
                tile.fileSize = FileUtil.formatBytes(fileSize);
            }
            name = StringUtil.addEmptySpaces([_.get(tile, 'file.name'), tile.fileSize, tile.picDateTaken]);
        }

        if(isRendering && tile.fromCache) {
            loadingText = 'Restoring from Cache';
            have = false;
        }

        if(isRendering && tile.thumbnailFiles) {
            const thumbFile = tile.thumbnailFiles.find(item => 'Thumbnail ' + tile.fileName === item.name);
            if(thumbFile) {
                previewThumbnail = URL.createObjectURL(thumbFile);
            }
        }

        return (
            <Paper style={{
                margin: '10px',
                padding: '10px'
            }}>
                {previewThumbnail ? <span>
                        <img src={previewThumbnail} alt={'Preview ' + tile.fileName}
                             className={classes.wide}/>
                    </span> : ''}

                <span className={classes.horizontal}>
                    <span className={classes.horizontal} style={{
                        position: 'relative', textAlign: 'center',
                    }}>
                        {have ? <CheckIcon
                                    style={{marginTop: '-14px'}} /> : <ImageIcon
                                                                className={classes.imageIcon} />}
                        {!have && <CircularProgress
                                    color="secondary"
                                    size={36} className={classes.fabProgress} />}
                    </span>
                    <Typography variant="caption" className={classes.wordwrap} style={{
                        marginTop: '-14px'
                    }}>
                        {loadingText}
                    </Typography>
                    {isLoading ? <span className={classes.horizontal} style={{
                        marginLeft: '10px'}}>
                                <span className={classes.vertical}>
                                    <span className={classes.vertical}>
                                        <CircularProgress style={{
                                                              width: '35px', height: '35px'
                                                          }}
                                                          variant="determinate"
                                                          value={progress}
                                        />
                                        <Typography className={classes.progressPercentageText}
                                                    variant={"caption"}>{progressPercentage}</Typography>
                                    </span>
                                </span>
                                <div className={classes.vertical} style={{ width: '80px', marginTop: '-14px'}}>
                                        <Typography className={classes.progressSpeedText}
                                                    variant={"caption"}>{downSpeed}</Typography>
                                        <Typography className={classes.progressSpeedText}
                                                    variant={"caption"}>{upSpeed}</Typography>
                                </div>
                                <div className={classes.vertical} style={{ width: '110px'}}>
                                    <Typography className={classes.progressSpeedText}
                                                style={{
                                                    marginTop: '-14px'
                                                }}
                                                variant={"caption"}>{timeRemaining}</Typography>
                                </div>
                    </span> : ''}
                    <IconButton onClick={this.handleDelete.bind(this, tile)}
                                style={{
                                    marginTop: '-14px'
                                }}>
                        <DeleteIcon />
                    </IconButton>
                </span>
            <Divider variant="middle" />
            <span style={{
                position: 'relative',
                textAlign: 'center',
                marginRight: '10px'
            }}>
                    <Typography variant="caption" className={classes.wordwrap}>
                        {name}
                    </Typography>
                </span>
            <Divider variant="middle" />
            <div style={{width: '100%', height: '100%'}}>
                <PiecesLoadingView master={master} tile={tile} />
            </div>
            <Divider variant="middle" />
            {!isRendering ? <OwnersList emitter={master.emitter}
                        tile={tile} peers={master.peers} myPeerId={master.client.peerId}
            /> : ''}
        </Paper>
        );
    }
}

export default withStyles(styles)(LoadingTile);