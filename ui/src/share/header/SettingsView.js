import React, { useState, useEffect, useRef, useCallback } from 'react';
import PropTypes from 'prop-types';

import Logger from 'js-logger';

import Button from '@mui/material/Button';
import IconButton from '@mui/material/IconButton';
import TuneRounded from '@mui/icons-material/TuneRounded';
import { headerButtonSx } from './headerButtonSx';
import PeerNameField from './PeerNameField';
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

export const PRIVATE_ROOMS_TEXT = 'When this is on, rooms that you start are private. Each phone encrypts the photos, '
    + 'their file names and the room name with a key in the room link. The server cannot read them. '
    + 'In a private room you cannot share titles, ratings or places, and people need the full link or code to see the photos. '
    + 'Rooms that you started before stay as they are.';

function SettingsView(props) {
    const {master, enqueueSnackbar, closeSnackbar, prefersDarkMode, showButton = true} = props;
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
    const [keepCopies, setKeepCopies] = useState(false);
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

    // Room-wide, so it follows the room rather than this browser.
    useEffect(() => {
        const handleRoomSettings = settings => setKeepCopies(!!settings?.keepCopies);
        master.emitter.on('roomSettings', handleRoomSettings);
        return () => master.emitter.removeListener?.('roomSettings', handleRoomSettings);
    }, [master.emitter]);

    const handleKeepCopiesChange = useCallback(async (value) => {
        setKeepCopies(value);
        try {
            const settings = await masterRef.current.service.updateRoomSettings({ keepCopies: value });
            setKeepCopies(!!settings?.keepCopies);
        } catch (err) {
            Logger.warn('keepCopies: ' + err);
            setKeepCopies(!value);
            enqueueSnackbar?.("Couldn't change the room: " + (err?.message || err), { variant: 'error' });
        }
    }, [enqueueSnackbar]);

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
            {/* Hidden in simple mode; it stays mounted for the log and stored settings. */}
            {showButton && (
                <IconButton
                    aria-label="Settings"
                    aria-haspopup="true"
                    onClick={showLogs}
                    sx={headerButtonSx}
                >
                    <TuneRounded />
                </IconButton>
            )}

            <Dialog
                open={open}
                onClose={handleClose}
                slots={{ transition: Transition }}
                keepMounted
                maxWidth="sm"
                fullWidth
            >
                <DialogTitle>Settings</DialogTitle>
                <DialogContent>
                    {/* Who you are to everyone else. */}
                    <SectionHeader label="You" />
                    <PeerNameField master={master} />

                    {/* Privacy */}
                    <SectionHeader label="Privacy" />
                    <SettingToggle
                        checked={encrypt}
                        onChange={handleEncryptChange}
                        label="Private rooms"
                        description={PRIVATE_ROOMS_TEXT}
                    />

                    {/* Sharing */}
                    <SectionHeader label="Sharing (this room)" />
                    <SettingToggle
                        checked={keepCopies}
                        onChange={handleKeepCopiesChange}
                        label="Keep Copies for Latecomers"
                        description="Photos go from phone to phone. Sometimes the server keeps a copy for 24 hours at most: when a phone cannot get a photo directly, for clips, or when a phone goes to the background before all people have a photo. Turn this on to keep a copy of each photo for 24 hours. Then people who join later still get the photos."
                    />

                    {/* Display */}
                    <SectionHeader label="Display" />
                    <SettingToggle
                        checked={showTopology}
                        onChange={handleTopologyChange}
                        label="Topology View"
                        description="Shows a map of the connected devices."
                    />
                    <SettingToggle
                        checked={showMe}
                        onChange={handleShowMeChange}
                        label="Me View"
                        description="Highlights your device on the network map."
                    />
                    <SettingToggle
                        checked={darkMode}
                        onChange={handleDarkModeChange}
                        label="Dark Theme"
                        description="Changes between light and dark colors."
                    />

                    {/* Advanced */}
                    <SectionHeader label="Advanced" />
                    <SettingToggle
                        checked={strategyPreference}
                        onChange={handleStrategyPreferenceChange}
                        label="Prefer Sequential Download"
                        description="Downloads pieces in order, not rarest first. Sharing between many people can be slower."
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
    showButton: PropTypes.bool,
};

export default withSnackbar(SettingsView);
