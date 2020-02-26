import React, { Component } from 'react';
import {withStyles} from '@material-ui/core/styles';
import Typography from "@material-ui/core/Typography";
import List from "@material-ui/core/List";
import ListItem from "@material-ui/core/ListItem";
import AccountCircleRounded from "@material-ui/icons/AccountCircleRounded";
import GroupRounded from "@material-ui/icons/GroupRounded";
import Paper from "@material-ui/core/Paper";
import Logger from 'js-logger';
import _ from 'lodash';

import ExpansionPanel from '@material-ui/core/ExpansionPanel';
import ExpansionPanelSummary from '@material-ui/core/ExpansionPanelSummary';
import ExpansionPanelDetails from '@material-ui/core/ExpansionPanelDetails';
import ExpandMoreIcon from '@material-ui/icons/ExpandMore';
import Badge from "@material-ui/core/Badge";
import StringUtil from "../util/StringUtil";
import CheckIcon from "@material-ui/icons/CheckRounded";
import NatListItem from "../util/NatListItem";
import UserListItem from "../util/UserListItem";

const styles = theme => ({
    vertical: {
        width: '100%',
        display: 'flex',
        flexDirection: 'column',
        alignItems: 'center',
        justifyContent: 'center'
    },
    verticalAndWide: {
        display: 'flex',
        flexDirection: 'column',
        width: '100%'
    },
    horizontal: {
        width: '100%',
        display: 'flex',
        flexDirection: 'row',
        alignItems: 'center',
        justifyContent: 'center'
    },
    content: {
        padding: '0px 0px 0px 0px',
        width: '100%',
        overflow: 'hidden'
    },
    notStartedSelected: {
        minWidth: '5px', minHeight: '3px',
        marginRight: '1px', marginBottom: '1px',
        backgroundColor: '#bdbdbd'
    },
    notStarted: {
        minWidth: '4px', minHeight: '2px',
        marginRight: '1px', marginBottom: '1px',
        borderStyle: 'solid', borderWidth: '1px', borderColor: '#bdbdbd'
        //backgroundColor: '#bdbdbd', //7b7b7b
    },
    inProgress: {
        minWidth: '5px', minHeight: '3px',
        marginRight: '1px', marginBottom: '1px',
        backgroundColor: 'yellow',
        //borderStyle: 'solid',
        //borderWidth: '1px',
        //borderColor: 'yellow',
    },
    done: {
        //width: '10px', height: '8px',
        minWidth: '5px', minHeight: '3px',
        marginRight: '1px', marginBottom: '1px',
        backgroundColor: 'green',
    }
});

class PiecesLoadingView extends Component {

    constructor(props) {
        super(props);

        const {master} = props;
        const emitter = master.emitter;

        emitter.on('downloadProgress', this.handleDownloadProgress, this);
        emitter.on('uploadProgress', this.handleUploadProgress, this);
    }

    componentDidUpdate(nextProps) {
        const tile = nextProps.tile;
        if (tile && tile.torrent) {
            if(!this.hasPieces(tile)) {
                Logger.info('subscribe to metadata ' + tile.torrent.name);
                tile.torrent.on('metadata', () => {
                    Logger.info('handleMetadata ' + tile.torrent.name);
                    this.setState({tile: tile});
                });
            }
            /*Logger.info('componentDidUpdate ' + this);
            const id = setInterval(() => {
                if(this.hasPieces(torrent)) {
                    this.setState({torrent: torrent});
                    clearInterval(id);
                }
            }, 200);*/
        }
    }

    handleDownloadProgress(event) {
        const torrent = event.torrent;
        if(torrent.infoHash === this.props.torrent && this.props.torrent.infoHash) {
            const progress = event.progress;
            this.setState({
                progress: progress,
                downSpeed: event.speed,
                timeRemaining: event.timeRemaining});
        }
    }

    handleUploadProgress(event) {
        const torrent = event.torrent;
        if(torrent.infoHash === this.props.torrent && this.props.torrent.infoHash) {
            const progress = event.progress;
            this.setState({
                progress: progress,
                upSpeed: event.speed,
                timeRemaining: event.timeRemaining});
        }
    }

    handleMetadata(torrent) {
        Logger.info('handleMetadata ' + torrent.name);
        this.setState({torrent: torrent});
    }

    componentWillUnmount() {
        this.props.master.emitter.removeListener('downloadProgress', this.handleDownloadProgress, this);
        this.props.master.emitter.removeListener('uploadProgress', this.handleUploadProgress, this);
        //if(this.props.torrent) {
        //    this.props.torrent.removeListener('metadata', this.handleMetadata, this);
        //}
    }

    hasPieces(tile) {
        return tile && tile.torrent && tile.torrent.pieces && tile.torrent.pieces.length > 0;
    }

    renderPieces(torrent, classes) {
        return <div style={{
        width: '100%',
        display: 'flex',
        //flexDirection: 'row',
        //flexWrap: 'wrap',
        //alignItems: 'center',
        //justifyContent: 'flex-start',
        flexFlow: 'row wrap',
        alignItems: 'stretch',
        justifyContent: 'stretch',
        }}>
            {torrent.pieces.map((piece, index) => {
                let brick;
                if(!piece) {
                    brick = <span key={index} className={classes.done}/>
                } else if(piece && piece.missing < piece.length) {
                    const percentage = piece.missing / piece.length * 100;
                    brick = <span key={index} className={classes.inProgress}>
                        <span style={{
                            width: percentage, height: '100%',
                            backgroundColor: 'red',
                        }}/>
                    </span>
                } else {
                    const isSelected = torrent._selections.find(item => _.inRange(index, item.from, item.to));
                    brick = isSelected
                        ? <span key={index} className={classes.notStartedSelected}/>
                        : <span key={index} className={classes.notStarted}/>
                }

                return brick;
            })}
        </div>
    }

    render() {
        const {classes, tile} = this.props;

        return (
            this.hasPieces(tile) ?
                    <div style={{
                        margin: '10px',
                    }}>
                            {
                                this.renderPieces(tile.torrent, classes)
                            }
                    </div> : ''
        );
    }
}

export default withStyles(styles)(PiecesLoadingView);