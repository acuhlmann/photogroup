import React, { Component } from 'react';
import {withStyles} from '@material-ui/core/styles';
import Typography from "@material-ui/core/Typography";
import Paper from "@material-ui/core/Paper";
import OwnersList from "./OwnersList";
import IconButton from "@material-ui/core/IconButton";
import CloudDownloadIcon from "@material-ui/icons/CloudDownload";
import DeleteIcon from "@material-ui/icons/Delete";
import PhotoDetails from "./PhotoDetails";
import Logger from "js-logger";
import download from "downloadjs";
import update from "immutability-helper";
import Button from "@material-ui/core/Button/Button";
import { withSnackbar } from 'notistack';

const styles = theme => ({
    horizontal: {
        display: 'flex',
        flexDirection: 'row',
        alignItems: 'center',
        justifyContent: 'center'
    },
    vertical: {
        display: 'flex',
        flexDirection: 'column'
    },
    wordwrap: {
        wordWrap: 'break-word'
    },
    wide: {
        width: '100%',
    },
    gridList: {
        marginBottom: '-5px'
    },
    toolbar: {
        display: 'flex',
        alignItems: 'center',
        flexWrap: 'wrap',
        padding: '5px',
    },
});

class ContentTile extends Component {

    constructor(props) {
        super(props);

        const {master} = props;
        const emitter = master.emitter;
        emitter.on('galleryListView', isList => {

            this.setState({listView: isList});
        }, this);

        this.state = {
            open: false,
            listView: true,
            localDownloads: []
        }
    }

    /*addServerPeer(tile, action) {

        Logger.info(tile.torrent.magnetURI);

        const self = this;
        this.props.master.service.addServerPeer(tile.torrent.magnetURI).then(result => {

            self.props.master.emitter.emit('appEventRequest', {level: 'warning', type: 'serverPeer',
                event: {action: action, sharedBy: tile.sharedBy}
            });
            Logger.info('Shared server peer ' + result.url);

        }).catch(err => {

            Logger.warn('addServerPeer already added? ' + err);

            self.props.enqueueSnackbar('Image already shared with photogroup.network', {
                variant: 'error',
                autoHideDuration: 6000,
                action: <Button className={self.props.classes.white} size="small">x</Button>
            });
        });
    }*/

    handleOpen(tile) {

        this.setState((state, props) => ({
            open: true,
            tile: tile
        }));
    }

    handleClose() {
        this.setState({ open: false });
    }

    downloadFromServer(tile) {
        Logger.info('downloadFromServer ' + tile.fileName);
        download(tile.elem, tile.fileName);
        const localDownloads = update(this.state.localDownloads, {$push: [tile.infoHash]});
        this.setState({localDownloads: localDownloads});
    }

    async handleDelete(tile) {
        const infoHash = await this.props.master.torrentDeletion.deleteItem(tile.torrent);
        Logger.info('handleDelete ' + tile.torrent.name + ' ' + infoHash + ' ' + tile.torrent.infoHash);
    }

    handleContainerLoaded(tile, node, file) {
        if(!tile || !file) {
            return;
        }

        if(!node) {
            return;
        }

        if(node.hasChildNodes()) {
            const tileInfoHash = tile.torrent.infoHash;
            const nodeInfoHash = node.infoHash;
            if(tileInfoHash !== nodeInfoHash) {
                this.removeFile(node);
                node.infoHash = tile.torrent.infoHash;
                this.appendFile(tile, node, file);
            }
            return;
        }

        node.infoHash = tile.torrent.infoHash;
        this.appendFile(tile, node, file);
    }

    appendFile(tile, node, file) {
        const opts = {
            autoplay: true,
            muted: true, loop: true
        };
        const self = this;
        file.appendTo(node, opts, (err, elem) => {
            // file failed to download or display in the DOM
            if (err) {
                //Unsupported file type
                const msgNode = document.createElement("div");                 // Create a <li> node
                const msgNodeText = document.createTextNode(err);         // Create a text node
                msgNode.appendChild(msgNodeText);
                node.appendChild(msgNode);

                Logger.error('webtorrent.appendTo ' + err.message);
                const {enqueueSnackbar, closeSnackbar} = self.props;
                enqueueSnackbar(err.message, {
                    variant: 'error',
                    persist: false,
                    autoHideDuration: 4000,
                    action: (key) => (<Button className={self.props.classes.white} onClick={ () => closeSnackbar(key) } size="small">x</Button>),
                });
            }

            console.log('New DOM node with the content', elem);
            if(elem && elem.style) {
                elem.style.width = '100%';
                elem.style.height = '100%';
            }

            if(tile.isVideo) {
                if(elem)
                    elem.loop = true;
            }
        });
    }

    removeFile(node) {
        while (node.firstChild) {
            node.removeChild(node.firstChild);
        }
    }

    render() {

        const {tile, name, master, classes} = this.props;
        const {open, localDownloads, listView} = this.state;

        const renderMediaDom = tile.isImage
            ? <img src={tile.img} alt={tile.fileName}
                   className={classes.wide} />
            : <div className={classes.wide}
                   ref={ref => this.handleContainerLoaded(tile, ref, tile.torrent.files[0])}>
            </div>;

        return (
            <div>
                <div className={classes.gridList}>

                    {renderMediaDom}

                    {listView ? <Paper className={classes.toolbar}>

                        <div style={{width: '100%'}} className={classes.horizontal}>

                            <IconButton onClick={this.downloadFromServer.bind(this, tile)}>
                                <CloudDownloadIcon/>
                            </IconButton>
                            {localDownloads.includes(tile.infoHash) ? <Typography variant={"caption"}>Downloaded</Typography> : ''}
                            {/*<IconButton onClick={this.handleOpen.bind(this, tile)} className={classes.icon}>
                                <InfoIcon />
                            </IconButton>*/}
                            <Typography onClick={this.handleOpen.bind(this, tile)} className={classes.wordwrap}
                                        title={tile.picSummary}
                                        variant="caption">{name}
                            </Typography>
                            <IconButton onClick={this.handleDelete.bind(this, tile)}
                                        className={classes.icon}>
                                <DeleteIcon />
                            </IconButton>
                            {/*<IconButton onClick={this.addServerPeer.bind(this, tile, label)}>
                                <CloudUploadIcon/>
                            </IconButton>*/}
                        </div>
                        <div style={{width: '100%'}}>
                            {/*<Typography variant={"caption"}>first shared by {tile.peerId}</Typography>*/}
                            <OwnersList emitter={master.emitter}
                                        tile={tile} owners={tile.owners} peers={master.peers} myPeerId={master.client.peerId}
                            />
                        </div>
                    </Paper> : ''}
                </div>
                <PhotoDetails open={open}
                              tile={tile}
                              master={master}
                              handleClose={this.handleClose.bind(this)} />
            </div>
        );
    }
}

export default withSnackbar(withStyles(styles)(ContentTile));