import React, { useState, useEffect, useMemo, useRef, useCallback } from 'react';
import PropTypes from 'prop-types';
import {ThemeProvider} from '@mui/material/styles';
import { createAppTheme } from './theme';

import AppBar from '@mui/material/AppBar';
import Toolbar from '@mui/material/Toolbar';
import Typography from '@mui/material/Typography';
import CssBaseline from '@mui/material/CssBaseline';
import Box from '@mui/material/Box';
import Stack from '@mui/material/Stack';
import Chip from '@mui/material/Chip';
import './App.css';

import EventEmitter from 'eventemitter3';

import TorrentMaster from "./share/torrent/TorrentMaster";
import RoomsService from "./share/RoomsService";

import ShareCanvas from './share/ShareCanvas';
import SettingsView from "./share/header/SettingsView";
import Logger from 'js-logger';
import Uploader from "./share/header/Uploader";

import { SnackbarProvider } from 'notistack';
import Visibility from "visibilityjs";
import AddPeersView from "./share/header/AddPeersView";
import { clearShareFlag, rememberRoom, SHARE_ERRORS, SHARE_WAITING, takeSharedFiles } from "./share/shareTarget";
import ModeSwitch from "./share/header/ModeSwitch";
import { readMode, saveMode } from "./share/uiMode";
import RoomMenu from "./share/header/RoomMenu";
import useRoom from "./share/useRoom";

function App({theme: propsTheme, prefersDarkMode}) {
    //Logger.useDefaults();
    Logger.setLevel(Logger.INFO);

    // Before RoomsService is created below: it marks the first visit.
    const [mode, setMode] = useState(readMode);
    const changeMode = useCallback((next) => {
        saveMode(next);
        setMode(next);
    }, []);

    const emitterRef = useRef(null);
    const masterRef = useRef(null);

    if (!emitterRef.current) {
        emitterRef.current = new EventEmitter();
    }
    if (!masterRef.current) {
        masterRef.current = new TorrentMaster(new RoomsService(emitterRef.current), emitterRef.current);
        masterRef.current.service.master = masterRef.current;
    }

    const [theme, setTheme] = useState(() =>
        propsTheme || createAppTheme('dark')
    );
    const [networkStatus, setNetworkStatus] = useState({ peers: 0, downSpeed: '', upSpeed: '' });
    const [inRoom, setInRoom] = useState(() => new URLSearchParams(window.location.search).has('room'));
    const room = useRoom(masterRef.current, inRoom);

    // Photos shared from other apps go into the room once it is ready, the
    // same way as a pick from Share (see share/shareTarget.js).
    const deliverSharedFiles = useCallback(async () => {
        const emitter = emitterRef.current;
        rememberRoom(masterRef.current.service.id);
        const shared = new URLSearchParams(window.location.search).get('shared');
        if (!shared) return;
        clearShareFlag();
        if (SHARE_ERRORS[shared]) {
            emitter.emit('showError', SHARE_ERRORS[shared]);
            return;
        }
        try {
            const files = await takeSharedFiles();
            if (files.length) {
                Logger.info('Adding ' + files.length + ' files shared from another app');
                emitter.emit('filesSelected', files);
            }
        } catch (error) {
            Logger.error('Failed to read shared files: ' + (error && error.message ? error.message : error));
            emitter.emit('showError', SHARE_ERRORS.error);
        }
    }, []);

    useEffect(() => {
        // Ensure theme is set from props if available
        if (propsTheme && !theme) {
            setTheme(propsTheme);
        }
    }, [propsTheme, theme]);

    useEffect(() => {
        // Update theme if props.theme changes
        if (propsTheme && propsTheme !== theme) {
            setTheme(propsTheme);
        }
    }, [propsTheme, theme]);

    useEffect(() => {
        const handleAddPeerDone = () => {
            reactToTouchInOut();
        };

        const handleDarkMode = (isDark) => {
            setTheme(createAppTheme(isDark ? 'dark' : 'light'));
        };

        const handleNumPeersChange = (numPeers) => {
            setNetworkStatus(prev => ({ ...prev, peers: numPeers }));
        };

        const handleDownloadProgress = (event) => {
            setNetworkStatus(prev => ({ ...prev, downSpeed: event.speed || '' }));
        };

        const handleUploadProgress = (event) => {
            setNetworkStatus(prev => ({ ...prev, upSpeed: event.speed || '' }));
        };

        emitterRef.current.on('addPeerDone', handleAddPeerDone);
        emitterRef.current.on('darkMode', handleDarkMode);
        emitterRef.current.on('readyToUpload', deliverSharedFiles);
        const handleInRoom = () => setInRoom(true);
        emitterRef.current.on('readyToUpload', handleInRoom);
        emitterRef.current.on('numPeersChange', handleNumPeersChange);
        emitterRef.current.on('downloadProgress', handleDownloadProgress);
        emitterRef.current.on('uploadProgress', handleUploadProgress);

        // A share that arrived before any room was opened waits for one.
        const params = new URLSearchParams(window.location.search);
        if (params.get('shared') === '1' && !params.has('room')) {
            emitterRef.current.emit('showInfo', SHARE_WAITING);
        }

        return () => {
            emitterRef.current.removeListener('addPeerDone', handleAddPeerDone);
            emitterRef.current.removeListener('darkMode', handleDarkMode);
            emitterRef.current.removeListener('readyToUpload', deliverSharedFiles);
            emitterRef.current.removeListener('readyToUpload', handleInRoom);
            emitterRef.current.removeListener('numPeersChange', handleNumPeersChange);
            emitterRef.current.removeListener('downloadProgress', handleDownloadProgress);
            emitterRef.current.removeListener('uploadProgress', handleUploadProgress);
        };
    }, [deliverSharedFiles]);

    const reactToTouchInOut = () => {
        if(Visibility.isSupported()) {
            Logger.info('Visibility.isSupported');
        } else {
            Logger.warn('Visibility NOT supported');
        }

        Visibility.change(async (e, state) => {
            if(state === 'visible') {
                Logger.info('Visibility.change ' + state);
                const response = await masterRef.current.service.updatePeer(masterRef.current.service.peerData);
                if(!response) return;
                const {photos, peers} = response;
                if(photos && peers) {
                    masterRef.current.reload();
                }
            }
        });
    };

    // Use state theme if available, otherwise fall back to props theme or default
    const currentTheme = useMemo(() => {
        return theme || propsTheme || createAppTheme('dark');
    }, [theme, propsTheme]);

    const hasActivity = networkStatus.downSpeed || networkStatus.upSpeed;
    const simple = mode === 'simple';

    return (
        <ThemeProvider theme={currentTheme}>
            <CssBaseline />
            <SnackbarProvider
                anchorOrigin={{
                    vertical: 'bottom',
                    horizontal: 'left',
                }}
                maxSnack={3}>
                <div className="App">
                    <header className="App-header">
                        <AppBar position="static" enableColorOnDark sx={{ color: 'text.primary' }}>
                            <Toolbar
                                variant="dense"
                                sx={{
                                    gap: 1.25,
                                    py: 0.75,
                                    minHeight: { xs: 52, sm: 58 },
                                    alignItems: 'center',
                                }}
                            >
                                <Stack
                                    direction="row"
                                    spacing={1.25}
                                    sx={{ alignItems: 'center', flexGrow: 1, minWidth: 0 }}
                                >
                                    <Box className="mark" aria-hidden="true" sx={{ display: { xs: inRoom ? 'none' : 'grid', sm: 'grid' } }} />
                                    <Stack direction="column" spacing={0} sx={{ flex: 1, minWidth: 0, alignItems: 'flex-start' }}>
                                        {/* In a room, a phone shows the room's name alone. */}
                                        <Typography
                                            variant="subtitle1"
                                            component="h1"
                                            sx={{
                                                display: { xs: inRoom ? 'none' : 'block', sm: 'block' },
                                                fontWeight: 600,
                                                lineHeight: 1.15,
                                                fontSize: { xs: '0.98rem', sm: '1.05rem' },
                                                letterSpacing: '-0.03em',
                                            }}
                                        >
                                            PhotoGroup
                                        </Typography>
                                        {inRoom ? (
                                            <RoomMenu master={masterRef.current} name={room.name} label={room.label}
                                                isPrivate={room.isPrivate} missingKey={room.missingKey} />
                                        ) : (
                                            <Typography
                                                className="tech-text"
                                                sx={{
                                                    display: { xs: 'none', sm: 'block' },
                                                    lineHeight: 1.2,
                                                    color: 'text.secondary',
                                                }}
                                            >
                                                Peer to peer · lossless
                                            </Typography>
                                        )}
                                    </Stack>
                                </Stack>

                                {/* Action buttons */}
                                <Stack direction="row" spacing={0.75} sx={{ alignItems: 'center', flexShrink: 0 }}>
                                    <ModeSwitch mode={mode} onChange={changeMode} compact={inRoom && !simple}/>
                                    {/* One Invite and one Add photos button. Simple mode has big ones in
                                        the page instead; these stay mounted for their dialogs and file input. */}
                                    <AddPeersView master={masterRef.current} showButton={!simple}
                                        inRoom={inRoom} roomName={room.name}/>
                                    <Uploader
                                        model={masterRef.current.torrentAddition}
                                        emitter={masterRef.current.emitter}
                                        showButton={!simple}
                                    />
                                    <SettingsView
                                        master={masterRef.current}
                                        emitter={masterRef.current.emitter}
                                        prefersDarkMode={prefersDarkMode}
                                        showButton={!simple}
                                    />
                                </Stack>
                            </Toolbar>

                            {/* Network status bar */}
                            {!simple && (networkStatus.peers > 0 || hasActivity) && (
                                <Box
                                    className="telemetry"
                                    sx={{
                                        display: 'flex',
                                        alignItems: 'center',
                                        gap: 1.5,
                                        px: 2,
                                        py: 0.4,
                                        borderTop: 1,
                                        borderColor: 'divider',
                                        color: 'text.secondary',
                                    }}
                                >
                                    <Box className="live-dot" aria-hidden="true" />
                                    {networkStatus.peers > 0 && (
                                        <Chip
                                            size="small"
                                            label={`${networkStatus.peers} peer${networkStatus.peers !== 1 ? 's' : ''}`}
                                            variant="outlined"
                                            sx={{
                                                height: 20,
                                                borderColor: 'divider',
                                                color: 'text.secondary',
                                                '& .MuiChip-label': { px: 1 },
                                            }}
                                        />
                                    )}
                                    {networkStatus.downSpeed && (
                                        <Typography variant="caption" sx={{ fontFamily: 'var(--font-mono)', fontSize: '0.68rem', color: 'text.secondary' }}>
                                            ↓ {networkStatus.downSpeed}
                                        </Typography>
                                    )}
                                    {networkStatus.upSpeed && (
                                        <Typography variant="caption" sx={{ fontFamily: 'var(--font-mono)', fontSize: '0.68rem', color: 'text.secondary' }}>
                                            ↑ {networkStatus.upSpeed}
                                        </Typography>
                                    )}
                                </Box>
                            )}
                        </AppBar>
                    </header>

                    <main className="App-main">
                        <ShareCanvas master={masterRef.current} mode={mode} roomName={room.name} />
                    </main>
                </div>
            </SnackbarProvider>
        </ThemeProvider>
    );
}

App.propTypes = {
    prefersDarkMode: PropTypes.bool.isRequired,
    theme: PropTypes.object,
};

export default App;
