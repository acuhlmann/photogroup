import React, { Component } from 'react';
import PropTypes from 'prop-types';
import { withStyles } from '@material-ui/core/styles';
import AppBar from '@material-ui/core/AppBar';
import Toolbar from '@material-ui/core/Toolbar';
import Typography from '@material-ui/core/Typography'
import './App.css';
import ShareCanvas from './share/ShareCanvas';
import TorrentMaster from "./share/TorrentMaster";
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
        this.master = new TorrentMaster();
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
                            <LogView ref={ node => this.logView = node}
                                     master={this.master}/>
                        </Toolbar>
                    </AppBar>
                </header>

                <div className="App-intro">
                  <ShareCanvas master={this.master}/>
                </div>
            </div>
        );
    }
}

App.propTypes = {
    classes: PropTypes.object.isRequired,
};

export default withStyles(styles)(App);
