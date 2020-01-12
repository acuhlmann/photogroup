import React, { Component } from 'react';
import PropTypes from 'prop-types';

import { withStyles } from '@material-ui/core/styles';

import CircularProgress from '@material-ui/core/CircularProgress';
import FileUtil from '../util/FileUtil';
//import Logger from "js-logger";
import Typography from '@material-ui/core/Typography';

const styles = theme => ({
    button: {
        margin: theme.spacing(1),
    },
    input: {
        display: 'none',
    },
    progressContainer: {
        display: 'flex',
        //position: 'inherit'
    },
    progress: {
        margin: theme.spacing(2),
        position: 'absolute',
        //top: '-7px',
        right: '78px',
    },
    vertical: {
        display: 'flex',
        flexDirection: 'column'
    },
    progressText: {
        position: 'relative',
        fontSize: '0.5rem',
        wordBreak: 'break-word',
        width: '110px',
        top: '50px',
    },
    progressTextTop: {
        position: 'relative',
        fontSize: '0.5rem',
        wordBreak: 'break-word',
        width: '110px',
        top: '20px',
    }
});

class LoaderView extends Component {

    constructor(props) {
        super(props);

        this.loader = props.loader;
        this.loader.parent = this;

        this.state = {
            show: false,
            progress: 0,
            down: '', up: '', downSpeed: '', upSpeed: ''
        };

        const { classes, emitter } = props;
        this.classes = classes;

        const self = this;

        emitter.on('downloadProgress', event => {
            const progress = event.progress;
            const show = (progress > 0 && progress < 100);
            //self.setState({show: show, progress: progress, downSpeed: event.speed});
        });
        emitter.on('uploadProgress', event => {
            const progress = event.progress;
            const show = (progress > 0 && progress < 100);
            //self.setState({show: show, progress: progress, upSpeed: event.speed});
        });

        //let progressRunner;
        emitter.on('wtInitialized', client => {
            let lastDownload = 0;
            let lastUpload = 0;
            let lastProgress = 0;
            setInterval(() => {

                const progress = client.progress * 100;
                const show = (progress > 0 && progress < 100);
                const uploadSpeedLabel = FileUtil.formatBytes(client.uploadSpeed) + '/sec';
                const downloadSpeedLabel = FileUtil.formatBytes(client.downloadSpeed) + '/sec';
                const ratio = client.ratio === 0 ? '' : client.ratio;
                self.setState({show: show, progress: progress,
                    upSpeed: uploadSpeedLabel, downSpeed: downloadSpeedLabel, ratio: ratio});

                if(client.torrents && client.torrents.length > 0) {

                    //const progress = client.progress.toFixed(1) * 100;
                    //const show = (progress > 0 && progress < 100);
                    lastProgress = progress;
                    //Logger.debug('client.progress ' + progress
                    //    + ' show ' + show);
                    //self.setState({progress: progress, show: show});

                    const totalDownloaded = client.torrents.map(item => item.downloaded).reduce((a, b) => a + b, 0);
                    const totalUploaded = client.torrents.map(item => item.uploaded).reduce((a, b) => a + b, 0);
                    if(totalDownloaded !== lastDownload || totalUploaded !== lastUpload) {
                        const down = FileUtil.formatBytes(totalDownloaded);
                        const up = FileUtil.formatBytes(totalUploaded);
                        //Logger.debug('downloaded ' + down
                        //    + ' uploaded ' + up);
                        //Logger.debug('client.progress ' + progress
                        //    + ' show ' + show);
                        lastDownload = totalDownloaded;
                        lastUpload = totalUploaded;
                        //const progress = client.progress.toFixed(1) * 100;
                        //const downSpeed = FileUtil.formatBytes(client.downloadSpeed) + '/sec';
                        //const upSpeed = FileUtil.formatBytes(client.uploadSpeed) + '/sec';
                        self.setState({ down: 'down ' + down, up: 'up ' + up});
                        //self.setState({ down: down, up: up,
                        //    downSpeed: downSpeed, upSpeed: upSpeed,
                        //    progress: progress });
                    }
                }

            }, 200);
        });
    }

    render() {
        const {classes} = this.props;
        const {show, down, up, downSpeed, upSpeed, progress, ratio} = this.state;

        return (
            <div>
                {show ? <div className={classes.progressContainer}>
                    <CircularProgress id="progressBar"
                                      className={classes.progress}
                                      variant="static"
                                      value={progress}
                    />
                    <div className={classes.vertical}>
                        <Typography className={classes.progressText}
                                    variant={"caption"}>{down} {downSpeed}</Typography>
                        <Typography className={classes.progressText}
                                    variant={"caption"}>{up} {upSpeed}</Typography>
                    </div>
                </div> : <div className={classes.vertical}>
                    <Typography className={classes.progressTextTop}
                                variant={"caption"}>{ratio}</Typography>
                    <Typography className={classes.progressText}
                                variant={"caption"}>{down}</Typography>
                    <Typography className={classes.progressText}
                                variant={"caption"}>{up}</Typography>
                </div>}
            </div>
        );
    }
}

LoaderView.propTypes = {
    classes: PropTypes.object.isRequired,
    emitter: PropTypes.object.isRequired,
};

export default withStyles(styles)(LoaderView);