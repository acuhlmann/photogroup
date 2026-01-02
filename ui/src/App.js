import React, { useState, useEffect, useMemo, useRef } from 'react';
import PropTypes from 'prop-types';
import {ThemeProvider, createTheme} from '@mui/material/styles';

import AppBar from '@mui/material/AppBar';
import Toolbar from '@mui/material/Toolbar';
import Typography from '@mui/material/Typography'
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

function App({theme: propsTheme, prefersDarkMode}) {
    //Logger.useDefaults();
    Logger.setLevel(Logger.INFO);

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
        propsTheme || createTheme({
            palette: {
                mode: 'light'
            }
        })
    );

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
            console.log('fllkj');
            const newTheme = createTheme({
                palette: {
                    mode: isDark ? 'dark' : 'light'
                }
            });
            setTheme(newTheme);
        };

        emitterRef.current.on('addPeerDone', handleAddPeerDone);
        emitterRef.current.on('darkMode', handleDarkMode);

        return () => {
            emitterRef.current.removeListener('addPeerDone', handleAddPeerDone);
            emitterRef.current.removeListener('darkMode', handleDarkMode);
        };
    }, []);

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
        return theme || propsTheme || createTheme({
            palette: {
                mode: 'light'
            }
        });
    }, [theme, propsTheme]);

    return (
        <ThemeProvider theme={currentTheme}>
            <SnackbarProvider
                anchorOrigin={{
                    vertical: 'bottom',
                    horizontal: 'left',
                }}
                maxSnack={3}>
                <div className="App">
                    <header className="App-header">
                        <AppBar position="static" color="default">
                            <Toolbar>
                                <div style={{flexGrow: 1}}>
                                    <Typography variant="button" component="h2">
                                        PhotoGroup
                                    </Typography>
                                    <Typography variant="caption">
                                        Zero Install, Peer-to-Peer Photo Collaboration.
                                    </Typography>
                                </div>
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
                            </Toolbar>
                        </AppBar>
                    </header>

                    <div className="App-intro">
                        <ShareCanvas master={masterRef.current} />
                    </div>
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

