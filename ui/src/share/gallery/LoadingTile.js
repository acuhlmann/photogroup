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
        left: '-10px',
    },
    progressPercentageText: {
        position: 'relative',
        fontSize: '0.7rem',
        bottom: '13px', left: '-28px'
    },
    progressSpeedText: {
        fontSize: '0.7rem',
        wordBreak: 'break-word',
    },
    fabProgress: {
        position: 'absolute',
        zIndex: 1,
        left: '-17px',
        top: '-6px'
    },
});

class LoadingTile extends Component {

    constructor(props) {
        super(props);

        const {master, tile} = props;
        const emitter = master.emitter;

        const self = this;
        emitter.on('downloadProgress', event => {

            const torrent = event.torrent;
            if(torrent.infoHash === tile.infoHash) {
                const progress = event.progress;
                self.setState({
                    progress: progress,
                    downSpeed: event.speed,
                    timeRemaining: event.timeRemaining});
            }

        }, this);

        emitter.on('uploadProgress', event => {

            const torrent = event.torrent;
            if(torrent.infoHash === tile.infoHash) {
                const progress = event.progress;
                self.setState({
                    progress: progress,
                    upSpeed: event.speed,
                    timeRemaining: event.timeRemaining});
            }
        }, this);

        this.state = {
            progress: null,
            downSpeed: '', upSpeed: '',
            timeRemaining: ''
        }
    }

    render() {
        const {tile, master, classes} = this.props;
        let {name} = this.props;

        const {downSpeed, upSpeed, timeRemaining, progress} = this.state;

        //tile.loading = true;
        //progress = 80;
        //downSpeed = '100kb/sec';
        //upSpeed = '0kb/sec';

        //let owners = tile.owners ? tile.owners : [];
        const progressPercentage = progress ? Math.round(progress) + '%' : progress;
        const have = tile.owners.find(owner => owner.peerId === master.client.peerId && !owner.loading);
        const isLoading = !!progress;
        const loadingText = tile.rendering && !isLoading ? 'Rendering' : (isLoading ? 'Loading' : 'Find Network Path');
        const isRendering = loadingText === 'Rendering';
        if(tile.rendering && !name) {
            const fileSize = _.get(tile, 'file.size');
            if(fileSize && !tile.fileSize) {
                tile.fileSize = FileUtil.formatBytes(fileSize);
            }
            name = StringUtil.addEmptySpaces([_.get(tile, 'file.name'), tile.fileSize, tile.picDateTaken]);
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
                            {have ? <CheckIcon /> : <ImageIcon className={classes.imageIcon} />}
                            {!have && <CircularProgress
                                color="secondary"
                                size={36} className={classes.fabProgress} />}
                        </span>
                        <Typography variant="caption" className={classes.wordwrap}>
                            {loadingText}
                        </Typography>
                        {isLoading ? <span className={classes.horizontal} style={{ marginLeft: '10px'}}>
                                    <span className={classes.vertical}>
                                        <div>
                                            <CircularProgress id="progressBar"
                                                              style={{
                                                                  width: '35px', height: '35px'
                                                              }}
                                                              variant="static"
                                                              value={progress}
                                            />
                                            <Typography className={classes.progressPercentageText}
                                                        variant={"caption"}>{progressPercentage}</Typography>
                                        </div>
                                    </span>
                                    <div className={classes.vertical} style={{ marginLeft: '-10px'}}>
                                            <Typography className={classes.progressSpeedText}
                                                        variant={"caption"}>{downSpeed}</Typography>
                                            <Typography className={classes.progressSpeedText}
                                                        variant={"caption"}>{upSpeed}</Typography>
                                    </div>
                            <div className={classes.vertical} style={{ marginLeft: '10px'}}>
                                <Typography className={classes.progressSpeedText}
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
                            tile={tile} owners={tile.owners} peers={master.peers} myPeerId={master.client.peerId}
                /> : ''}
            </Paper>
        );
    }
}

export default withStyles(styles)(LoadingTile);