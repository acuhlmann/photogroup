import React, { useState, useEffect, useMemo, useRef, useCallback } from 'react';
import PropTypes from 'prop-types';
import {ThemeProvider} from '@mui/material/styles';
import { createAppTheme } from './theme';

import AppBar from '@mui/material/AppBar';
import Toolbar from '@mui/material/Toolbar';
import Typography from '@mui/material/Typography';
import CssBaseline from '@mui/material/CssBaseline';
import Container from '@mui/material/Container';
import Stack from '@mui/material/Stack';
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

// Helper function to open IndexedDB for share target files
function openShareTargetDB() {
    return new Promise((resolve, reject) => {
        const request = indexedDB.open('photogroup-share-target', 1);
        
        request.onerror = () => reject(request.error);
        request.onsuccess = () => resolve(request.result);
        
        request.onupgradeneeded = (event) => {
            const db = event.target.result;
            if (!db.objectStoreNames.contains('shared-files')) {
                db.createObjectStore('shared-files', { keyPath: 'id' });
            }
        };
    });
}

// Helper function to get all shared files from IndexedDB
async function getSharedFiles() {
    try {
        const db = await openShareTargetDB();
        return new Promise((resolve, reject) => {
            const tx = db.transaction('shared-files', 'readonly');
            const store = tx.objectStore('shared-files');
            const request = store.getAll();
            
            request.onsuccess = () => {
                db.close();
                resolve(request.result || []);
            };
            request.onerror = () => {
                db.close();
                reject(request.error);
            };
        });
    } catch (error) {
        Logger.error('Failed to get shared files:', error);
        return [];
    }
}

// Helper function to clear shared files from IndexedDB
async function clearSharedFiles() {
    try {
        const db = await openShareTargetDB();
        return new Promise((resolve, reject) => {
            const tx = db.transaction('shared-files', 'readwrite');
            const store = tx.objectStore('shared-files');
            const request = store.clear();
            
            request.onsuccess = () => {
                db.close();
                resolve();
            };
            request.onerror = () => {
                db.close();
                reject(request.error);
            };
        });
    } catch (error) {
        Logger.error('Failed to clear shared files:', error);
    }
}

function App({theme: propsTheme, prefersDarkMode}) {
    //Logger.useDefaults();
    Logger.setLevel(Logger.INFO);

    const emitterRef = useRef(null);
    const masterRef = useRef(null);
    const sharedFilesProcessedRef = useRef(false);
    
    if (!emitterRef.current) {
        emitterRef.current = new EventEmitter();
    }
    if (!masterRef.current) {
        masterRef.current = new TorrentMaster(new RoomsService(emitterRef.current), emitterRef.current);
        masterRef.current.service.master = masterRef.current;
    }

    const [theme, setTheme] = useState(() =>
        propsTheme || createAppTheme('light')
    );

    // Handle shared files from Web Share Target API
    const processSharedFiles = useCallback(async () => {
        if (sharedFilesProcessedRef.current) return;
        
        const urlParams = new URLSearchParams(window.location.search);
        if (!urlParams.has('shared')) return;
        
        sharedFilesProcessedRef.current = true;
        Logger.info('Processing shared files from Share Target API');
        
        try {
            const sharedFiles = await getSharedFiles();
            
            if (sharedFiles.length > 0) {
                Logger.info('Found ' + sharedFiles.length + ' shared files');
                
                // Convert ArrayBuffer data back to File objects
                const files = sharedFiles.map(item => {
                    const blob = new Blob([item.data], { type: item.type });
                    return new File([blob], item.name, { type: item.type });
                });
                
                // Emit event with the files so they can be uploaded
                emitterRef.current.emit('sharedFilesReceived', files);
                
                // Clear the shared files from IndexedDB
                await clearSharedFiles();
                
                Logger.info('Shared files processed and cleared');
            }
            
            // Clean up the URL (remove ?shared=true)
            const newUrl = window.location.pathname;
            window.history.replaceState({}, document.title, newUrl);
            
        } catch (error) {
            Logger.error('Failed to process shared files:', error);
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
            // Process shared files after the app is ready
            processSharedFiles();
        };

        const handleDarkMode = (isDark) => {
            setTheme(createAppTheme(isDark ? 'dark' : 'light'));
        };

        // Handle shared files received event
        const handleSharedFilesReceived = (files) => {
            Logger.info('Received ' + files.length + ' files from Share Target');
            // The Uploader component or TorrentMaster should handle adding these files
            if (masterRef.current && masterRef.current.torrentAddition) {
                files.forEach(file => {
                    // Create a mock event-like object for the uploader
                    const dataTransfer = new DataTransfer();
                    dataTransfer.items.add(file);
                    emitterRef.current.emit('filesSelected', dataTransfer.files);
                });
            }
        };

        emitterRef.current.on('addPeerDone', handleAddPeerDone);
        emitterRef.current.on('darkMode', handleDarkMode);
        emitterRef.current.on('sharedFilesReceived', handleSharedFilesReceived);

        // Also try to process shared files on initial load (in case addPeerDone already fired)
        setTimeout(() => {
            processSharedFiles();
        }, 1000);

        return () => {
            emitterRef.current.removeListener('addPeerDone', handleAddPeerDone);
            emitterRef.current.removeListener('darkMode', handleDarkMode);
            emitterRef.current.removeListener('sharedFilesReceived', handleSharedFilesReceived);
        };
    }, [processSharedFiles]);

    const reactToTouchInOut = () => {
        if(Visibility.isSupported()) {
            Logger.info('Visibility.isSupported');
        } else {
            Logger.warn('Visibility NOT supported');
        }

        Visibility.change(async (e, state) => {
            //Statistics.visibilityChange(state);

            if(state === 'visible') {
                Logger.info('Visibility.change ' + state);
                const response = await masterRef.current.service.updatePeer(masterRef.current.service.peerData);
                if(!response) return;
                const {photos, peers} = response;
                if(photos && peers) {
                    masterRef.current.reload();
                    /*
                    //tried to do this without refreshing the page, but failed so far.
                    Logger.info(`photos: ${photos.length} peers ${peers.length}`);
                    emitterRef.current.emit('peers', {type: 'all', item: peers});
                    masterRef.current.client.torrents.forEach(torrent => {
                        masterRef.current.torrentAddition.add(torrent);
                    });
                    emitterRef.current.emit('photos', {type: 'all', item: photos});
                    const results = await masterRef.current.fillMissingOwners(photos);
                    Logger.info('fillMissingOwners results ' + results);
                    const lastResults = await masterRef.current.service.getRoom();
                    emitterRef.current.emit('peers', {type: 'all', item: lastResults.peers});
                    emitterRef.current.emit('photos', {type: 'all', item: lastResults.photos});
                    */
                }
            }
        });
    };

    // Use state theme if available, otherwise fall back to props theme or default
    const currentTheme = useMemo(() => {
        return theme || propsTheme || createAppTheme('light');
    }, [theme, propsTheme]);

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
                        <AppBar position="static" enableColorOnDark>
                            <Toolbar
                                variant="dense"
                                sx={{
                                    flexWrap: 'wrap',
                                    gap: 1,
                                    py: 1,
                                    alignItems: 'center',
                                }}
                            >
                                <Stack
                                    direction="column"
                                    spacing={0}
                                    sx={{ flexGrow: 1, minWidth: 0, textAlign: 'left' }}
                                >
                                    <Typography variant="h6" component="h1" sx={{ lineHeight: 1.25 }}>
                                        PhotoGroup
                                    </Typography>
                                    <Typography
                                        variant="body2"
                                        sx={{
                                            opacity: 0.92,
                                            display: { xs: 'none', sm: 'block' },
                                            lineHeight: 1.3,
                                        }}
                                    >
                                        Zero Install, Peer-to-Peer Photo Collaboration.
                                    </Typography>
                                </Stack>
                                <Stack direction="row" spacing={0.5} alignItems="center" sx={{ flexShrink: 0 }}>
                                    <AddPeersView master={masterRef.current}/>
                                    <Uploader
                                        model={masterRef.current.torrentAddition}
                                        emitter={masterRef.current.emitter}
                                    />
                                    <SettingsView
                                        master={masterRef.current}
                                        emitter={masterRef.current.emitter}
                                        prefersDarkMode={prefersDarkMode}
                                    />
                                </Stack>
                            </Toolbar>
                        </AppBar>
                    </header>

                    <main className="App-main">
                        <Container maxWidth="lg" sx={{ px: { xs: 2, sm: 3 }, py: { xs: 2, sm: 3 } }}>
                            <ShareCanvas master={masterRef.current} />
                        </Container>
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
