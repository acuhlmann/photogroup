import React, { Component } from 'react';
import PropTypes from 'prop-types';
import { withStyles } from '@material-ui/core/styles';
import AppBar from '@material-ui/core/AppBar';
import Toolbar from '@material-ui/core/Toolbar';
import Typography from '@material-ui/core/Typography'
import './App.css';

import EventEmitter from 'eventemitter3';

import TorrentMaster from "./share/model/TorrentMaster";
import RoomsService from "./share/RoomsService";
import GalleryModel from "./share/GalleryModel";

import ShareCanvas from './share/ShareCanvas';
import LogView from "./share/LogView";

const styles = {
    root: {
        flexGrow: 1,
    },
};

class App extends Component {

    constructor(props) {
        super(props);

        const { classes } = props;
        this.classes = classes;

        const scope = this;

        const emitter = new EventEmitter();
        this.master = new TorrentMaster(new RoomsService(emitter), emitter);
        this.gallery = new GalleryModel(this.master);

        this.master.emitter.on('deleted', magnetURI => {
            this.gallery.performDeleteTile(magnetURI);
        }, this);

        this.master.emitter.on('added', (toAdd) => {
            this.gallery.addMediaToDom(toAdd.file, toAdd.torrent);
        }, this);

        //When webtorrent errors on a duplicated add, try to remove and re-seed.
        //This may happen if client state is lost
        //i.e. due to removal of browser (indexeddb cache)
        this.master.emitter.on('duplicate', (duplicated) => {
            if(!this.gallery.getTileByUri(duplicated.torrentId).item) {
                duplicated.torrent.client.remove(duplicated.torrentId, () => {
                    scope.master.torrentAddition.seed(duplicated.files);
                });
            }
        }, this);
    }

    render() {
        return (
            <div className="App">
                <header className="App-header">
                    <AppBar position="static" color="default">
                        <Toolbar>
                            <Typography variant="title" color="inherit" align="center">
                                PhotoGroup - Zero Install, Peer-to-Peer Photo Group Collaboration.
                            </Typography>
                            <LogView emitter={this.master.emitter}/>
                        </Toolbar>
                    </AppBar>
                </header>

                <div className="App-intro">
                  <ShareCanvas master={this.master} gallery={this.gallery}/>
                </div>
            </div>
        );
    }
}

App.propTypes = {
    classes: PropTypes.object.isRequired,
};

export default withStyles(styles)(App);

