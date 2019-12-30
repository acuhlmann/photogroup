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
import GalleryModel from "./share/gallery/GalleryModel";

import ShareCanvas from './share/ShareCanvas';
import SettingsView from "./share/header/SettingsView";
import Logger from 'js-logger';
import Uploader from "./share/loader/Uploader";

import { SnackbarProvider } from 'notistack';
import Visibility from "visibilityjs";
import QRCodeButton from "./share/header/QRCodeButton";

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

        const scope = this;

        Logger.useDefaults();
        //Logger.setLevel(Logger.INFO);

        const emitter = new EventEmitter();
        this.master = new TorrentMaster(new RoomsService(emitter), emitter);
        this.master.service.master = this.master;
        this.gallery = new GalleryModel(this.master);

        this.master.emitter.on('deletedTorrent', infoHash => {
            this.gallery.performDeleteTile(infoHash);
        }, this);

        this.master.emitter.on('added', toAdd => {
            this.gallery.addMediaToDom(toAdd);
        }, this);

        //When webtorrent errors on a duplicated add, try to remove and re-seed.
        //This may happen if client state is lost
        //i.e. due to removal of browser (indexeddb cache)
        this.master.emitter.on('duplicate', (duplicated) => {

            const tileItem = scope.gallery.getTileByUri(duplicated.torrentId);
            console.log('duplicate ' + tileItem.item.torrent.infoHash);
            if(!tileItem.item || (tileItem.item && tileItem.item.loading)) {
                duplicated.torrent.client.remove(duplicated.torrentId, () => {
                    if(duplicated.files) {
                        //TODO: temporarily disable due to files disapearing bug in seed.torrent
                        //return;
                        scope.master.torrentAddition.seed(duplicated.files, undefined, duplicated.files, () => {
                            Logger.info('seeded duplicate');
                        });
                    }
                });
            }
        }, this);


        if(Visibility.isSupported() ) {
            Logger.log('Visibility.isSupported');
        } else {
            Logger.log('Visibility NOT supported');
        }

        Visibility.change((e, state) => {
            //Statistics.visibilityChange(state);
            Logger.log('Visibility.change ' + state);
            if(state === 'visible') {
                const peerId = this.master.client && this.master.client.peerId;
                if(peerId) {
                    this.master.service.getPeer(peerId)
                        .catch((err) => {
                            Logger.log('reconnect ');
                            if(Number(err.message) === 404) {
                                this.master.creator.buildTopology();
                            }
                        });
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
                                            Zero Install, Peer-to-Peer Photo Group Collaboration.
                                        </Typography>
                                    </div>
                                    <QRCodeButton master={this.master}/>
                                    <Uploader model={this.master.torrentAddition}
                                              emitter={this.master.emitter}
                                              loader={this.master.torrentAddition.loader} />
                                    <SettingsView master={this.master} emitter={this.master.emitter}/>
                                </Toolbar>
                            </AppBar>
                        </header>

                        <div className="App-intro">
                          <ShareCanvas
                              master={this.master} gallery={this.gallery}/>
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

