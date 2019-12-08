import React, { Component } from 'react';
import PropTypes from 'prop-types';

import { withStyles } from '@material-ui/core/styles';

import CircularProgress from '@material-ui/core/CircularProgress';
import FileUtil from '../util/FileUtil';
import Logger from "js-logger";
import Typography from '@material-ui/core/Typography';

const styles = theme => ({
    button: {
        margin: theme.spacing(1),
    },
    input: {
        display: 'none',
    },
    progressContainer: {
        zIndex: 1001,
        display: 'flex',
        position: 'inherit'
    },
    progress: {
        margin: theme.spacing(2),
        position: 'absolute',
        top: '25px',
        right: '50px',
    },
    vertical: {
        display: 'flex',
        flexDirection: 'column'
    },
    progressText: {
        position: 'relative',
        fontSize: '0.5rem',
        wordBreak: 'break-word',
        width: '40px',
        left: '8px',
    }
});

class LoaderView extends Component {

    constructor(props) {
        super(props);

        this.loader = props.loader;
        this.loader.parent = this;

        this.state = {
            show: false,
            completed: 0,
            down: 0, up: 0
        };

        const { classes } = props;
        this.classes = classes;

        const self = this;

        let progressRunner;
        props.emitter.on('wtInitialized', client => {
            let lastDownload = 0;
            let lastUpload = 0;
            progressRunner = setInterval(() => {

                const loader = {
                    progress: client.progress.toFixed(1) * 100,
                    ratio: client.ratio,
                    downloadSpeed: (client.downloadSpeed / 1024).toFixed(1) + 'kb/s',
                    uploadSpeed: (client.uploadSpeed / 1024).toFixed(1) + 'kb/s'
                };
                if(client.torrents && client.torrents.length > 0) {
                    const totalDownloaded = client.torrents.map(item => item.downloaded).reduce((a, b) => a + b, 0);
                    const totalUploaded = client.torrents.map(item => item.uploaded).reduce((a, b) => a + b, 0);
                    if(totalDownloaded !== lastDownload || totalUploaded !== lastUpload) {
                        const down = FileUtil.formatBytes(totalDownloaded);
                        const up = FileUtil.formatBytes(totalUploaded);
                        Logger.log('downloaded ' + down
                            + ' uploaded ' + up);
                        lastDownload = totalDownloaded;
                        lastUpload = totalUploaded;
                        self.setState({ down: down, up: up })
                    }
                }

            }, 200);
        });
    }

    render() {
        const {classes} = this.props;
        const {down, up, completed} = this.state;

        /*
        {this.state.show ? <div className={classes.progressContainer}>
                    <CircularProgress id="progressBar"
                                      className={classes.progress}
                                      variant="static"
                                      value={completed}
                    />
                    <Typography className={classes.progressText}
                                variant={"caption"}>{down}/{up}</Typography>
                </div> : ''}
         */

        return (
            <div>
                {this.state.show ? <div className={classes.progressContainer}>
                    <CircularProgress id="progressBar"
                                      className={classes.progress}
                                      variant="static"
                                      value={completed}
                    />
                    <div className={classes.vertical}>
                        <Typography className={classes.progressText}
                                    variant={"caption"}>{down}</Typography>
                        <Typography className={classes.progressText}
                                    variant={"caption"}>{up}</Typography>
                    </div>
                </div> : ''}
            </div>
        );
    }
}

LoaderView.propTypes = {
    classes: PropTypes.object.isRequired,
    emitter: PropTypes.object.isRequired,
};

export default withStyles(styles)(LoaderView);