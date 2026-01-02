import React, { useState, useEffect } from 'react';
import {withStyles} from '@mui/styles';
import Typography from "@mui/material/Typography";
import List from "@mui/material/List";
import ListItem from "@mui/material/ListItem";
import AccountCircleRounded from "@mui/icons-material/AccountCircleRounded";
import GroupRounded from "@mui/icons-material/GroupRounded";
import Paper from "@mui/material/Paper";
import Logger from 'js-logger';
import _ from 'lodash';

import Accordion from '@mui/material/Accordion';
import AccordionSummary from '@mui/material/AccordionSummary';
import AccordionDetails from '@mui/material/AccordionDetails';
import ExpandMoreIcon from '@mui/icons-material/ExpandMore';
import Badge from "@mui/material/Badge";
import StringUtil from "../util/StringUtil";
import CheckIcon from "@mui/icons-material/CheckRounded";
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

function PiecesLoadingView({master, tile, classes}) {
    const [currentTile, setCurrentTile] = useState(tile);

    useEffect(() => {
        setCurrentTile(tile);
    }, [tile]);

    useEffect(() => {
        const handleDownloadProgress = (event) => {
            const torrent = event.torrent;
            if(torrent.infoHash === tile?.infoHash && tile?.torrent?.infoHash) {
                // Progress tracking can be handled here if needed
            }
        };

        const handleUploadProgress = (event) => {
            const torrent = event.torrent;
            if(torrent.infoHash === tile?.infoHash && tile?.torrent?.infoHash) {
                // Progress tracking can be handled here if needed
            }
        };

        master.emitter.on('downloadProgress', handleDownloadProgress);
        master.emitter.on('uploadProgress', handleUploadProgress);

        return () => {
            master.emitter.removeListener('downloadProgress', handleDownloadProgress);
            master.emitter.removeListener('uploadProgress', handleUploadProgress);
        };
    }, [master.emitter, tile]);

    useEffect(() => {
        if (tile && tile.torrent) {
            if(!hasPieces(tile)) {
                Logger.info('subscribe to metadata ' + tile.torrent.name);
                const handleMetadata = () => {
                    Logger.info('handleMetadata ' + tile.torrent.name);
                    setCurrentTile(tile);
                };
                tile.torrent.on('metadata', handleMetadata);
                return () => {
                    tile.torrent.removeListener('metadata', handleMetadata);
                };
            }
        }
    }, [tile]);

    const hasPieces = (tile) => {
        return tile && tile.torrent && tile.torrent.pieces && tile.torrent.pieces.length > 0;
    };

    const renderPieces = (torrent, classes) => {
        return (
            <div style={{
                width: '100%',
                display: 'flex',
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
                        brick = (
                            <span key={index} className={classes.inProgress}>
                                <span style={{
                                    width: percentage, 
                                    height: '100%',
                                    backgroundColor: 'red',
                                }}/>
                            </span>
                        );
                    } else {
                        const isSelected = torrent._selections?.find(item => _.inRange(index, item.from, item.to));
                        brick = isSelected
                            ? <span key={index} className={classes.notStartedSelected}/>
                            : <span key={index} className={classes.notStarted}/>
                    }

                    return brick;
                })}
            </div>
        );
    };

    if (!hasPieces(currentTile)) {
        return null;
    }

    return (
        <div style={{ margin: '10px' }}>
            {renderPieces(currentTile.torrent, classes)}
        </div>
    );
}

export default withStyles(styles)(PiecesLoadingView);