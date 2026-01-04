import React, { useState, useEffect, useRef, useCallback } from 'react';
import PropTypes from 'prop-types';

import Logger from 'js-logger';

import { withStyles } from '@mui/styles';
import Button from '@mui/material/Button';
import IconButton from '@mui/material/IconButton';
import Settings from '@mui/icons-material/Settings';
import CloseRounded from '@mui/icons-material/CloseRounded';
import Dialog from '@mui/material/Dialog';
import DialogContent from '@mui/material/DialogContent';
import DialogTitle from '@mui/material/DialogTitle';
import DialogActions from '@mui/material/DialogActions';

import List from '@mui/material/List';

import Switch from '@mui/material/Switch';
import FormGroup from '@mui/material/FormGroup';
import FormControlLabel from '@mui/material/FormControlLabel';

import {format} from 'date-fns';
import Typography from "@mui/material/Typography";
import {withSnackbar} from "../compatibility/withSnackbar";
import update from "immutability-helper";
import Slide from '@mui/material/Slide';

/* global __APP_VERSION__ */

const Transition = React.forwardRef(function Transition(props, ref) {
    return <Slide direction="down" ref={ref} {...props} />;
});

function getAppVersionString() {
    const base = (typeof __APP_VERSION__ !== 'undefined' && __APP_VERSION__) ? __APP_VERSION__ : 'dev';
    const build = import.meta?.env?.VITE_APP_VERSION;
    return build ? `${base}.${build}` : base;
}

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
});

function SettingsView(props) {
    const {classes, master, enqueueSnackbar, closeSnackbar, prefersDarkMode} = props;
    const masterRef = useRef(master);
    masterRef.current = master;

    const [messages, setMessages] = useState([]);
    const [open, setOpen] = useState(false);
    const [peerId, setPeerId] = useState('');
    const [showTopology, setShowTopology] = useState(true);
    const [showMe, setShowMe] = useState(true);
    const [encrypt, setEncrypt] = useState(false);
    const [strategyPreference, setStrategyPreference] = useState(false);
    const [darkMode, setDarkMode] = useState(prefersDarkMode);
    const logsBeforeMountRef = useRef([]);
    const mountedRef = useRef(false);

    const log = useCallback((message, level) => {
        if(mountedRef.current) {
            const msg = <div key={Math.random()}>
                <Typography variant="caption">{level + ': ' + message}</Typography>
            </div>;
            console.info(level, message);

            if(level === 'DEBUG' || level === 'INFO' || level === 'WARN' || level === 'ERROR') {
                setMessages(state => update(state, {$unshift: [msg]}));
            }
        } else {
            logsBeforeMountRef.current.push({message: message, level: level});
        }
    }, []);

    useEffect(() => {
        Logger.setHandler((messages, context) => {
            const date = format(new Date(), "HH:mm:ss:SSS");
            log(date + ' ' + messages[0], context.level.name);
        });

        Logger.info('platform ' + navigator.platform + ' cpu ' + navigator.oscpu);

        const handleAddPeerDone = () => {
            const showMeValue = localStorage.getItem('showMe') || showMe;
            handleShowMeChange(String(showMeValue) == 'true');

            const showTopologyValue = localStorage.getItem('showTopology');
            const showTopologyVal = showTopologyValue !== null ? showTopologyValue === 'true' : showTopology;
            handleTopologyChange(showTopologyVal);

            const encryptValue = localStorage.getItem('encrypt') || encrypt;
            handleEncryptChange(String(encryptValue) == 'true');

            const strategyPreferenceValue = localStorage.getItem('strategyPreference') || strategyPreference;
            handleStrategyPreferenceChange(String(strategyPreferenceValue) == 'true');

            const darkModeValue = localStorage.getItem('darkMode') || darkMode;
            handleDarkModeChange(String(darkModeValue) == 'true');

            setPeerId(masterRef.current.client.peerId);
            checkConnection();
        };

        master.emitter.on('addPeerDone', handleAddPeerDone);

        return () => {
            master.emitter.removeListener('addPeerDone', handleAddPeerDone);
        };
    }, [showMe, showTopology, encrypt, strategyPreference, darkMode, log]);

    const checkConnection = useCallback(() => {
        const connection = navigator.connection || navigator.mozConnection || navigator.webkitConnection;
        if(connection) {
            let type = connection.effectiveType;
            Logger.info("Connection type is " + type);
            masterRef.current.emitter.emit('connectionSpeedType', type);
            masterRef.current.service.updatePeer({
                connectionSpeedType: type
            });
            const updateConnectionStatus = () => {
                Logger.info("Connection type changed from " + type + " to " + connection.effectiveType);
                type = connection.effectiveType;
                masterRef.current.emitter.emit('connectionSpeedType', type);
                masterRef.current.service.updatePeer({
                    connectionSpeedType: type
                });
            };

            connection.addEventListener('change', updateConnectionStatus);
        }
    }, []);

    useEffect(() => {
        mountedRef.current = true;
        logsBeforeMountRef.current.forEach(missedMessage => log(missedMessage.message, missedMessage.level));
        logsBeforeMountRef.current = [];
    }, [log]);

    const showLogs = useCallback(() => {
        setOpen(true);
    }, []);

    const handleClose = useCallback(() => {
        setOpen(false);
    }, []);

    const handleTopologyChange = useCallback((value) => {
        localStorage.setItem('showTopology', String(value));
        masterRef.current.emitter.emit('showTopology', value);
        setShowTopology(value);
    }, []);

    const handleShowMeChange = useCallback((value) => {
        localStorage.setItem('showMe', value);
        masterRef.current.emitter.emit('showMe', value);
        setShowMe(value);
    }, []);

    const handleEncryptChange = useCallback((value) => {
        localStorage.setItem('encrypt', value);
        masterRef.current.emitter.emit('encrypt', value);
        setEncrypt(value);
    }, []);

    const handleStrategyPreferenceChange = useCallback((value) => {
        localStorage.setItem('strategyPreference', value);
        masterRef.current.emitter.emit('strategyPreference', value);
        setStrategyPreference(value);
    }, []);

    const handleDarkModeChange = useCallback((value) => {
        localStorage.setItem('darkMode', value);
        masterRef.current.emitter.emit('darkMode', value);
        setDarkMode(value);
    }, []);

    const messagesList = <List>
        {messages}
    </List>;

    return (
        <div>
            <IconButton
                aria-haspopup="true"
                onClick={showLogs}
                color="inherit"
            >
                <Settings />
            </IconButton>

            <Dialog
                open={open}
                onClose={handleClose}
                TransitionComponent={Transition}
                keepMounted
                maxWidth="md"
                fullWidth
            >
                <DialogTitle>Settings</DialogTitle>
                <DialogActions className={classes.vertical}>
                        <FormControlLabel
                            control={
                                <Switch
                                    onChange={(event) => handleEncryptChange(event.target.checked)}
                                    checked={encrypt}
                                    value="encrypt"
                                    color="primary"
                                />
                            }
                            label="Encrypt End-to-end"
                        />
                        <FormGroup row>
                            <FormControlLabel
                            control={
                                <Switch
                                    onChange={(event) => handleTopologyChange(event.target.checked)}
                                    checked={showTopology}
                                    value="showTopology"
                                    color="primary"
                                />
                            }
                            label="Topology View"
                        />
                            <FormControlLabel
                                control={
                                    <Switch
                                        onChange={(event) => handleShowMeChange(event.target.checked)}
                                        checked={showMe}
                                        value="showMe"
                                        color="primary"
                                    />
                                }
                                label="Me View"
                            />
                        </FormGroup>
                        <FormControlLabel
                            control={
                                <Switch
                                    onChange={(event) => handleStrategyPreferenceChange(event.target.checked)}
                                    checked={strategyPreference}
                                    value="strategyPreference"
                                    color="primary"
                                />
                            }
                            label="Prefer Sequential over Rarest-First Downloading?"
                        />
                        <FormControlLabel
                            control={
                                <Switch
                                    onChange={(event) => handleDarkModeChange(event.target.checked)}
                                    checked={darkMode}
                                    value="darkMode"
                                    color="primary"
                                />
                            }
                            label="Dark Theme"
                        />
                    <span className={classes.horizontal}>
                        <Button onClick={() => masterRef.current.restartTrackers()} color="secondary">
                            restart trackers
                        </Button>
                        <IconButton
                            onClick={handleClose}>
                            <CloseRounded />
                        </IconButton>
                    </span>
                </DialogActions>
                <DialogContent>
                    <Typography variant={"caption"}>v{getAppVersionString()} {peerId}</Typography>

                    {messagesList}
                </DialogContent>
            </Dialog>
        </div>
    );
}

SettingsView.propTypes = {
    classes: PropTypes.object.isRequired,
    emitter: PropTypes.object.isRequired,
    master: PropTypes.object.isRequired,
    prefersDarkMode: PropTypes.bool.isRequired,
};

export default withSnackbar(withStyles(styles)(SettingsView));
