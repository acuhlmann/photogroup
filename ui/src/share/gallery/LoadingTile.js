import React, { Component } from 'react';
import {withStyles} from '@material-ui/core/styles';
import Typography from "@material-ui/core/Typography";
import Paper from "@material-ui/core/Paper";
import _ from 'lodash';

import CheckIcon from "@material-ui/icons/CheckRounded";
import ImageIcon from "@material-ui/icons/ImageRounded";
import CircularProgress from "@material-ui/core/CircularProgress";
import Divider from "@material-ui/core/Divider";
import OwnersList from "./OwnersList";
import FileUtil from "../util/FileUtil";
import StringUtil from "../util/StringUtil";

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
});

class LoadingTile extends Component {

    constructor(props) {
        super(props);

        const {master, tile} = props;
        const emitter = master.emitter;

        emitter.on('downloadProgress', this.handleDownloadProgress, this);
        emitter.on('uploadProgress', this.handleUploadProgress, this);

        this.state = {
            progress: null,
            downSpeed: '', upSpeed: '',
            timeRemaining: ''
        }
    }

    handleDownloadProgress(event) {
        /*this.setState((state, props) => {

            const torrent = event.torrent;
            if(torrent.infoHash === props.tile.infoHash) {
                const progress = event.progress;
                return {
                    progress: progress,
                    downSpeed: event.speed,
                    timeRemaining: event.timeRemaining
                }
        });*/

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
        this.props.master.emitter.removeListener('downloadProgress', this.handleDownloadProgress, this);
        this.props.master.emitter.removeListener('uploadProgress', this.handleUploadProgress, this);
    }

    render() {
        const {tile, master, classes} = this.props;
        let {name} = this.props;

        let {downSpeed, upSpeed, timeRemaining, progress} = this.state;

        //progress = 80;
        //downSpeed = '100kb/sec';
        //upSpeed = '0kb/sec';
        //timeRemaining = 'in 1 minute';

        //let owners = tile.owners ? tile.owners : [];
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

        return (
            <Paper style={{
                margin: '10px',
                padding: '10px'
            }}>
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
                                                              variant="static"
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
                {!isRendering ? <OwnersList emitter={master.emitter}
                            tile={tile} peers={master.peers} myPeerId={master.client.peerId}
                /> : ''}
            </Paper>
        );
    }
}

export default withStyles(styles)(LoadingTile);