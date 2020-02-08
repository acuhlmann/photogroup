import React, { Component } from 'react';
import PropTypes from 'prop-types';
import {withStyles, createMuiTheme } from '@material-ui/core/styles';

import { ThemeProvider } from '@material-ui/styles';

import AppBar from '@material-ui/core/AppBar';
import Toolbar from '@material-ui/core/Toolbar';
import Typography from '@material-ui/core/Typography'
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

const styles = {
    typography: {
        useNextVariants: true,
    },
    root: {
        flexGrow: 1,
    },
    white: {
        color: '#ffffff'
    },
};

class App extends Component {

    constructor(props) {
        super(props);

        const { classes } = props;
        this.classes = classes;

        //Logger.useDefaults();
        Logger.setLevel(Logger.INFO);

        const emitter = new EventEmitter();
        this.master = new TorrentMaster(new RoomsService(emitter), emitter);
        this.master.service.master = this.master;

        emitter.on('addPeerDone', () => {

            this.reactToTouchInOut();
        });
    }

    reactToTouchInOut() {
        if(Visibility.isSupported() ) {
            Logger.info('Visibility.isSupported');
        } else {
            Logger.warn('Visibility NOT supported');
        }

        const self = this;
        Visibility.change(async (e, state) => {
            //Statistics.visibilityChange(state);

            if(state === 'visible') {

                Logger.info('Visibility.change ' + state);
                const response = await self.master.service.updatePeer(self.master.service.peerData);
                if(!response) return;
                const {photos, peers} = response;
                if(photos && peers) {
                    this.master.reload();
                    /*
                    //tried to do this without refreshing the page, but failed so far.
                    Logger.info(`photos: ${photos.length} peers ${peers.length}`);
                    this.emitter.emit('peers', {type: 'all', item: peers});
                    this.master.client.torrents.forEach(torrent => {
                        this.master.torrentAddition.add(torrent);
                    });
                    this.emitter.emit('photos', {type: 'all', item: photos});
                    const results = await this.master.fillMissingOwners(photos);
                    Logger.info('fillMissingOwners results ' + results);
                    const lastResults = await this.master.service.getRoom();
                    this.emitter.emit('peers', {type: 'all', item: lastResults.peers});
                    this.emitter.emit('photos', {type: 'all', item: lastResults.photos});
                    */
                }
            }
        });
    }

    render() {

        const defaultTheme = createMuiTheme();

        return (
            <ThemeProvider theme={defaultTheme}>
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
                                    <div edge="start" style={{flexGrow: 1}}>
                                        <Typography variant="button" component="h2">
                                            PhotoGroup
                                        </Typography>
                                        <Typography variant="caption">
                                            Zero Install, Peer-to-Peer Photo Collaboration.
                                        </Typography>
                                    </div>
                                    <AddPeersView master={this.master}/>
                                    <Uploader model={this.master.torrentAddition}
                                              emitter={this.master.emitter} />
                                    <SettingsView master={this.master} emitter={this.master.emitter}/>
                                </Toolbar>
                            </AppBar>
                        </header>

                        <div className="App-intro">
                          <ShareCanvas
                              master={this.master} />
                        </div>
                    </div>
                </SnackbarProvider>
            </ThemeProvider>
        );
    }
}

App.propTypes = {
    classes: PropTypes.object.isRequired,
};

export default withStyles(styles)(App);

