import React, { useState, useEffect, useRef, useCallback } from 'react';
import PropTypes from 'prop-types';

import Logger from 'js-logger';

import Button from '@mui/material/Button';
import IconButton from '@mui/material/IconButton';
import Settings from '@mui/icons-material/Settings';
import CloseRounded from '@mui/icons-material/CloseRounded';
import Dialog from '@mui/material/Dialog';
import DialogContent from '@mui/material/DialogContent';
import DialogTitle from '@mui/material/DialogTitle';
import DialogActions from '@mui/material/DialogActions';
import Box from '@mui/material/Box';
import Divider from '@mui/material/Divider';
import Collapse from '@mui/material/Collapse';

import Switch from '@mui/material/Switch';
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

function SectionHeader({ label }) {
    return (
        <Box sx={{ mt: 2, mb: 1 }}>
            <Typography
                variant="subtitle2"
                sx={{
                    textTransform: 'uppercase',
                    fontFamily: 'var(--font-mono)',
                    letterSpacing: '0.05em',
                    color: 'text.secondary',
                    mb: 0.5,
                }}
            >
                {label}
            </Typography>
            <Divider />
        </Box>
    );
}

function SettingToggle({ checked, onChange, label, description }) {
    return (
        <Box sx={{ py: 0.5 }}>
            <FormControlLabel
                control={
                    <Switch
                        checked={checked}
                        onChange={(event) => onChange(event.target.checked)}
                        color="primary"
                    />
                }
                label={
                    <Box>
                        <Typography variant="body2">{label}</Typography>
                        {description && (
                            <Typography variant="caption" color="text.secondary">
                                {description}
                            </Typography>
                        )}
                    </Box>
                }
                sx={{ alignItems: 'flex-start', ml: 0 }}
            />
        </Box>
    );
}

function getLogColor(level) {
    if (level === 'ERROR') return 'error.main';
    if (level === 'WARN') return 'warning.main';
    return 'text.secondary';
}

function SettingsView(props) {
    const {master, enqueueSnackbar, closeSnackbar, prefersDarkMode} = props;
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
    const [logsExpanded, setLogsExpanded] = useState(false);
    const logsBeforeMountRef = useRef([]);
    const mountedRef = useRef(false);
    const logsEndRef = useRef(null);

    const log = useCallback((message, level) => {
        if(mountedRef.current) {
            const entry = { key: Math.random(), message, level };
            console.info(level, message);

            if(level === 'DEBUG' || level === 'INFO' || level === 'WARN' || level === 'ERROR') {
                setMessages(state => update(state, {$push: [entry]}));
            }
        } else {
            logsBeforeMountRef.current.push({message: message, level: level});
        }
    }, []);

    useEffect(() => {
        if (logsExpanded && logsEndRef.current) {
            logsEndRef.current.scrollIntoView({ behavior: 'smooth' });
        }
    }, [messages, logsExpanded]);

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
                maxWidth="sm"
                fullWidth
            >
                <DialogTitle>Settings</DialogTitle>
                <DialogContent>
                    {/* Privacy */}
                    <SectionHeader label="Privacy" />
                    <SettingToggle
                        checked={encrypt}
                        onChange={handleEncryptChange}
                        label="Encrypt End-to-End"
                        description="Encrypts all data shared between peers so only participants can read it."
                    />

                    {/* Display */}
                    <SectionHeader label="Display" />
                    <SettingToggle
                        checked={showTopology}
                        onChange={handleTopologyChange}
                        label="Topology View"
                        description="Show the network topology graph of connected peers."
                    />
                    <SettingToggle
                        checked={showMe}
                        onChange={handleShowMeChange}
                        label="Me View"
                        description="Show your own node highlighted in the network view."
                    />
                    <SettingToggle
                        checked={darkMode}
                        onChange={handleDarkModeChange}
                        label="Dark Theme"
                        description="Switch between light and dark color schemes."
                    />

                    {/* Advanced */}
                    <SectionHeader label="Advanced" />
                    <SettingToggle
                        checked={strategyPreference}
                        onChange={handleStrategyPreferenceChange}
                        label="Prefer Sequential Download"
                        description="Download pieces in order instead of rarest-first. May reduce swarming efficiency."
                    />
                    <Box sx={{ py: 0.5, pl: 1 }}>
                        <Button
                            onClick={() => masterRef.current.restartTrackers()}
                            color="secondary"
                            variant="outlined"
                            size="small"
                        >
                            Restart Trackers
                        </Button>
                    </Box>

                    {/* Logs */}
                    <SectionHeader label="Logs" />
                    <Box sx={{ py: 0.5 }}>
                        <Button
                            size="small"
                            onClick={() => setLogsExpanded(prev => !prev)}
                        >
                            {logsExpanded ? 'Hide Logs' : 'Show Logs'}
                        </Button>
                    </Box>
                    <Collapse in={logsExpanded}>
                        <Box
                            sx={{
                                maxHeight: 300,
                                overflow: 'auto',
                                bgcolor: 'action.hover',
                                borderRadius: 1,
                                p: 1,
                                mt: 0.5,
                            }}
                        >
                            {messages.map((entry) => (
                                <Typography
                                    key={entry.key}
                                    variant="caption"
                                    component="div"
                                    sx={{
                                        fontSize: '0.7rem',
                                        fontFamily: 'var(--font-mono)',
                                        color: getLogColor(entry.level),
                                        whiteSpace: 'pre-wrap',
                                        wordBreak: 'break-all',
                                    }}
                                >
                                    {entry.level + ': ' + entry.message}
                                </Typography>
                            ))}
                            <div ref={logsEndRef} />
                        </Box>
                    </Collapse>
                </DialogContent>

                <DialogActions sx={{ justifyContent: 'space-between', px: 3, pb: 2 }}>
                    <Typography
                        variant="caption"
                        sx={{
                            fontFamily: 'var(--font-mono)',
                            color: 'text.disabled',
                        }}
                    >
                        v{getAppVersionString()} {peerId}
                    </Typography>
                    <IconButton onClick={handleClose}>
                        <CloseRounded />
                    </IconButton>
                </DialogActions>
            </Dialog>
        </div>
    );
}

SettingsView.propTypes = {
    emitter: PropTypes.object.isRequired,
    master: PropTypes.object.isRequired,
    prefersDarkMode: PropTypes.bool.isRequired,
};

export default withSnackbar(SettingsView);
