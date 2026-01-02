import React, { useState, useEffect, useRef } from 'react';
import PropTypes from 'prop-types';

import { withStyles } from '@mui/styles';

import CircularProgress from '@mui/material/CircularProgress';
import FileUtil from '../util/FileUtil';
//import Logger from "js-logger";
import Typography from '@mui/material/Typography';

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

function LoaderView({classes, emitter}) {
    const [show, setShow] = useState(false);
    const [progress, setProgress] = useState(0);
    const [down, setDown] = useState('');
    const [up, setUp] = useState('');
    const [downSpeed, setDownSpeed] = useState('');
    const [upSpeed, setUpSpeed] = useState('');
    const [ratio, setRatio] = useState('');
    const intervalRef = useRef(null);

    useEffect(() => {
        const handleDownloadProgress = (event) => {
            const progressValue = event.progress;
            const showValue = (progressValue > 0 && progressValue < 100);
            // Can update state here if needed
        };

        const handleUploadProgress = (event) => {
            const progressValue = event.progress;
            const showValue = (progressValue > 0 && progressValue < 100);
            // Can update state here if needed
        };

        emitter.on('downloadProgress', handleDownloadProgress);
        emitter.on('uploadProgress', handleUploadProgress);

        const handleWtInitialized = (client) => {
            let lastDownload = 0;
            let lastUpload = 0;
            let lastProgress = 0;
            
            intervalRef.current = setInterval(() => {
                const progressValue = client.progress * 100;
                const showValue = (progressValue > 0 && progressValue < 100);
                const uploadSpeedLabel = FileUtil.formatBytes(client.uploadSpeed) + '/sec';
                const downloadSpeedLabel = FileUtil.formatBytes(client.downloadSpeed) + '/sec';
                const ratioValue = client.ratio === 0 ? '' : client.ratio / 1000;
                
                setShow(showValue);
                setProgress(progressValue);
                setUpSpeed(uploadSpeedLabel);
                setDownSpeed(downloadSpeedLabel);
                setRatio(ratioValue);

                if(client.torrents && client.torrents.length > 0) {
                    lastProgress = progressValue;

                    const totalDownloaded = client.torrents.map(item => item.downloaded).reduce((a, b) => a + b, 0);
                    const totalUploaded = client.torrents.map(item => item.uploaded).reduce((a, b) => a + b, 0);
                    if(totalDownloaded !== lastDownload || totalUploaded !== lastUpload) {
                        const downValue = FileUtil.formatBytes(totalDownloaded);
                        const upValue = FileUtil.formatBytes(totalUploaded);
                        lastDownload = totalDownloaded;
                        lastUpload = totalUploaded;
                        setDown('down ' + downValue);
                        setUp('up ' + upValue);

                        emitter.emit('loadedAnything');
                    }
                }
            }, 200);
        };

        emitter.on('wtInitialized', handleWtInitialized);

        return () => {
            emitter.removeListener('downloadProgress', handleDownloadProgress);
            emitter.removeListener('uploadProgress', handleUploadProgress);
            emitter.removeListener('wtInitialized', handleWtInitialized);
            if (intervalRef.current) {
                clearInterval(intervalRef.current);
            }
        };
    }, [emitter]);

    return (
        <div>
            {show ? (
                <div className={classes.progressContainer}>
                    <CircularProgress 
                        id="progressBar"
                        className={classes.progress}
                        variant="determinate"
                        value={progress}
                    />
                    <div className={classes.vertical}>
                        <Typography className={classes.progressText} variant={"caption"}>
                            {down} {downSpeed}
                        </Typography>
                        <Typography className={classes.progressText} variant={"caption"}>
                            {up} {upSpeed}
                        </Typography>
                    </div>
                </div>
            ) : (
                <div className={classes.vertical}>
                    <Typography className={classes.progressTextTop} variant={"caption"}>
                        {ratio}
                    </Typography>
                    <Typography className={classes.progressText} variant={"caption"}>
                        {down}
                    </Typography>
                    <Typography className={classes.progressText} variant={"caption"}>
                        {up}
                    </Typography>
                </div>
            )}
        </div>
    );
}

LoaderView.propTypes = {
    classes: PropTypes.object.isRequired,
    emitter: PropTypes.object.isRequired,
};

export default withStyles(styles)(LoaderView);