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

import ToggleButton from '@mui/material/ToggleButton';
import ToggleButtonGroup from '@mui/material/ToggleButtonGroup';

import {format} from 'date-fns';
import Typography from "@mui/material/Typography";
import {withSnackbar} from "../compatibility/withSnackbar";
import update from "immutability-helper";
import Slide from '@mui/material/Slide';
import { readColors, saveColors } from '../colors';
import { forgetDevice } from '../forgetDevice';
import { readPreference, savePreference } from '../preferences';
import { askToNotify } from '../newPhotoNotices';
import { enablePush, disablePush } from '../pushNotices';
import PreferenceSwitch from './PreferenceSwitch';

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

function getLogColor(level) {
    if (level === 'ERROR') return 'error.main';
    if (level === 'WARN') return 'warning.main';
    return 'text.secondary';
}

const COLOR_CHOICES = [
    { value: 'device', label: 'Same as device' },
    { value: 'light', label: 'Light' },
    { value: 'dark', label: 'Dark' },
];

export const REMOVE_LOCATION_TEXT = 'Takes the place where a photo or clip was taken out of it on this phone, before anyone gets it.';
export const DATA_SAVER_TEXT = 'You get small previews first. A photo or clip comes only when you tap it. Use this on mobile data.';
export const NOTIFY_TEXT = 'Shows a notification when someone adds photos, and a push message when this browser is closed. '
    + 'An iPhone only gets the push after PhotoGroup is added to its Home Screen.';

export const FORGET_TEXT = 'Deletes your rooms list, your name and the saved photos from this browser. '
    + 'You cannot open private rooms again without their link. Rooms and photos on other phones stay.';

function SettingsView(props) {
    const {master, enqueueSnackbar, showButton = true} = props;
    const masterRef = useRef(master);
    masterRef.current = master;

    const [messages, setMessages] = useState([]);
    const [open, setOpen] = useState(false);
    const [peerId, setPeerId] = useState('');
    const [colors, setColors] = useState(readColors);
    const [confirmForget, setConfirmForget] = useState(false);
    const [removeLocation, setRemoveLocation] = useState(() => readPreference('removeLocation'));
    const [notify, setNotify] = useState(() => readPreference('notify'));
    const [dataSaver, setDataSaver] = useState(() => readPreference('dataSaver'));
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
            setPeerId(masterRef.current.client.peerId);
            checkConnection();
        };

        master.emitter.on('addPeerDone', handleAddPeerDone);

        return () => {
            master.emitter.removeListener('addPeerDone', handleAddPeerDone);
        };
    }, [log]);

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

    const handleColorsChange = useCallback((event, value) => {
        if (!value) return;
        saveColors(value);
        setColors(value);
    }, []);

    const handleRemoveLocationChange = useCallback((value) => {
        savePreference('removeLocation', value);
        setRemoveLocation(value);
    }, []);

    // The room knows, so nobody sends this phone photos it did not ask for.
    const handleDataSaverChange = useCallback((value) => {
        savePreference('dataSaver', value);
        setDataSaver(value);
        masterRef.current.service?.updatePeer?.({ dataSaver: value });
    }, []);

    const handleNotifyChange = useCallback(async (value) => {
        if (value && !(await askToNotify())) {
            enqueueSnackbar?.('The browser does not allow notifications. Allow them in the browser settings first.', { variant: 'warning' });
            value = false;
        }
        savePreference('notify', value);
        setNotify(value);
        // The permission alone only reaches a phone whose page is still open.
        // This is where the endpoint goes to the server, or comes off it.
        const service = masterRef.current.service;
        if (value) await enablePush({ service });
        else await disablePush({ service });
    }, [enqueueSnackbar]);

    const copyLogs = useCallback(async () => {
        const text = messages.map(entry => entry.level + ': ' + entry.message).join('\n');
        try {
            await navigator.clipboard.writeText(`PhotoGroup v${getAppVersionString()} ${peerId}\n${text}`);
            enqueueSnackbar?.('Logs copied', { variant: 'success' });
        } catch (err) {
            Logger.warn('copyLogs: ' + err);
            enqueueSnackbar?.("Couldn't copy the logs", { variant: 'error' });
        }
    }, [messages, peerId, enqueueSnackbar]);

    const handleClose = useCallback(() => {
        setOpen(false);
        setConfirmForget(false);
    }, []);

    return (
        <div>
            {/* Hidden in simple mode; it stays mounted to collect the log. */}
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

                    <SectionHeader label="Sharing" />
                    <PreferenceSwitch
                        checked={removeLocation}
                        onChange={handleRemoveLocationChange}
                        label="Remove location when I share"
                        description={REMOVE_LOCATION_TEXT}
                    />
                    <PreferenceSwitch
                        checked={dataSaver}
                        onChange={handleDataSaverChange}
                        label="Data saver"
                        description={DATA_SAVER_TEXT}
                    />
                    <PreferenceSwitch
                        checked={notify}
                        onChange={handleNotifyChange}
                        label="Tell me about new photos"
                        description={NOTIFY_TEXT}
                    />

                    <SectionHeader label="Colors" />
                    <ToggleButtonGroup
                        value={colors}
                        exclusive
                        onChange={handleColorsChange}
                        size="small"
                        aria-label="Colors"
                    >
                        {COLOR_CHOICES.map(choice => (
                            <ToggleButton key={choice.value} value={choice.value} sx={{ textTransform: 'none', px: 1.5 }}>
                                {choice.label}
                            </ToggleButton>
                        ))}
                    </ToggleButtonGroup>

                    {/* Logs */}
                    <SectionHeader label="Logs" />
                    <Box sx={{ py: 0.5, display: 'flex', gap: 1 }}>
                        <Button
                            size="small"
                            onClick={() => setLogsExpanded(prev => !prev)}
                        >
                            {logsExpanded ? 'Hide logs' : 'Show logs'}
                        </Button>
                        <Button size="small" onClick={copyLogs}>Copy logs</Button>
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

                    <SectionHeader label="This device" />
                    <Typography variant="caption" component="p" sx={{ color: 'text.secondary', mb: 1 }}>
                        {FORGET_TEXT}
                    </Typography>
                    {confirmForget ? (
                        <Box sx={{ display: 'flex', gap: 1 }}>
                            <Button size="small" onClick={() => setConfirmForget(false)}>Cancel</Button>
                            <Button size="small" color="error" variant="contained" onClick={() => forgetDevice()}>
                                Delete my data
                            </Button>
                        </Box>
                    ) : (
                        <Button size="small" color="error" variant="outlined" onClick={() => setConfirmForget(true)}>
                            Forget this device
                        </Button>
                    )}
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
    emitter: PropTypes.object,
    master: PropTypes.object.isRequired,
    showButton: PropTypes.bool,
};

export default withSnackbar(SettingsView);
