import React, { Component } from 'react';
import {withStyles} from '@material-ui/core/styles';
import Typography from "@material-ui/core/Typography";
import IconButton from "@material-ui/core/IconButton";
import Logger from "js-logger";
import update from "immutability-helper";
import Button from "@material-ui/core/Button/Button";
import Webamp from 'webamp';
import {Icon} from "@material-ui/core";
import { withSnackbar } from 'notistack';
import PropTypes from "prop-types";

const styles = theme => ({
    horizontal: {
        display: 'flex',
        flexDirection: 'row',
        alignItems: 'center',
        justifyContent: 'center'
    },
    wide: {
        width: '100%',
    },
    imageIcon: {
        height: '100%'
    },
    iconRoot: {
        textAlign: 'center'
    }
});

class RenderContent extends Component {

    constructor(props) {
        super(props);
    }

    componentDidMount() {
        const {master, tile} = this.props;
        const emitter = master.emitter;
        emitter.on('blobDone-' + tile.infoHash, this.handleBlobDone, this);
        tile.torrent.on('done', this.handleDone.bind(this, tile.torrent));
    }

    componentWillUnmount() {
        const {master, tile} = this.props;
        master.emitter.removeListener('blobDone-' + tile.infoHash, this.handleBlobDone, this);
        tile.torrent.removeListener('done', this.handleDone, this);
    }

    handleBlobDone(photo) {
        Logger.info('handleBlobDone ' + photo.fileName);
        const {tile, master} = this.props;
        tile.elem = photo.elem;
        master.emitter.emit('photos', {type: 'update', item: [tile]});
        this.readMetadata(tile);
    }

    async handleDone(torrent) {

        const {tile, master} = this.props;

        fetch(torrent.torrentFileBlobURL)
            .then(r => r.blob())
            .then(blobFile => new File([blobFile], tile.fileName, { type: tile.fileType }))
            .then(file => {
                console.log('handleDone torrentFileBlobURL ' + file);
                tile.elem = file;
                master.emitter.emit('photos', {type: 'update', item: [tile]});
                this.readMetadata(tile);
            });

        /*const file = torrent.files.find(file => file.name === tile.fileName);
        if(file) {
            file.getBlob((err, elem) => {
                Logger.info('handleDone getBlob done ' + file.name);
                if (err) {
                    Logger.error(err.message);
                } else {
                    tile.elem = new File([elem], tile.fileName, { type: tile.fileType });;
                    master.emitter.emit('photos', {type: 'update', item: [tile]});
                    this.readMetadata(tile);
                }
            });
        }*/
    }

    handleContainerLoaded(tile, node, file) {
        if(!tile || !file || !node) {
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

    handleWebamp(tile, node, file) {
        //return;
        if(!tile || !file || !node || !tile.isAudio) {
            return;
        }

        if(!Webamp.browserIsSupported()) {
            Logger.error("Oh no! Webamp does not work!")
            throw new Error("What's the point of anything?")
        }
        const webamp = new Webamp({
            initialTracks: [{
                metaData: {
                    artist: "DJ Mike Llama",
                    title: "Llama Whippin' Intro",
                },
                url: "llama-2.91.mp3"
            }],
            zIndex: 99999,
        });
        this.webamp = webamp;
        this.webampNode = node;
    }

    openInWebamp() {
        //return;
        const webamp = this.webamp;

        const elem = this.props.tile.elem;
        if(!this.openedWebamp) {
            if(elem) {
                this.openedWebamp = true;
                webamp.appendTracks([{blob: elem}]);
                webamp.renderWhenReady(this.webampNode).then(() => {
                    webamp.play();
                });
            }
        } else {
            webamp.setTracksToPlay([{blob: elem}]);
            webamp.reopen();
        }
    }

    appendFile(tile, node, file) {

        if(tile.secure) {

            const opts = {'announce': window.WEBTORRENT_ANNOUNCE, private: true};
            this.props.master.client.seed(tile.file, opts, (torrent) => {
                this.doAppendFile(tile, torrent.files[0], node);
            });

        } else {
            this.doAppendFile(tile, file, node);
            Logger.info('streaming start ' + tile.torrentFile.progress);
        }

        /*
        tile.torrent.critical(0, tile.torrent.pieces.length - 1);
        tile.torrent._rechoke();
        */
    }

    doAppendFile(tile, file, node) {

        const opts = {
            autoplay: !tile.isAudio,
            muted: !tile.isAudio, loop: true,
        };

        const self = this;
        file.appendTo(node, opts, (err, elem) => {
            // file failed to download or display in the DOM
            if (err) {
                //Unsupported file type
                const msgNode = document.createElement("div");                 // Create a <li> node
                const msgNodeText = document.createTextNode(err.message);         // Create a text node
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

            Logger.info('New DOM node with the content', elem);
            if(elem && elem.style) {
                elem.style.width = '100%';
                //elem.style.height = '100%';
            }

            this.getBlobAndReadMetadata(tile);

            if(tile.isVideo) {
                if(elem) {
                    //elem.preload = 'none';
                    //elem.autoplay = true;
                    elem.loop = true;
                    //elem.play();
                }
            }
        });
    }

    snack(payload, type = 'info', persist = false, vertical = 'bottom') {

        const {enqueueSnackbar, closeSnackbar} = this.props;

        enqueueSnackbar(payload, {
            variant: type,
            persist: persist,
            autoHideDuration: 4000,
            action: (key) => (<Button className={this.props.classes.white} onClick={ () => closeSnackbar(key) } size="small">x</Button>),
            anchorOrigin: {
                vertical: vertical,
                horizontal: 'right'
            }
        });
    }

    getBlobAndReadMetadata(tile) {
        Logger.info('streaming done ' + tile.torrentFile.progress);
        const master = this.props.master;

        if(tile.elem) {
            Logger.info('streaming getBlob ' + tile.torrentFile);
            this.readMetadata(tile);
        } else {
            master.emitter.on('blobDone-' + tile.infoHash, (photo) => {
                Logger.info('getBlobAndReadMetadata blobDone ' + tile.fileName);
                if(!tile.elem) {
                    tile.elem = photo.elem;
                    this.readMetadata(tile);
                }
            }, this);
        }
    }

    readMetadata(tile) {
        const master = this.props.master;
        if(tile.elem) {
            master.metadata.readMetadata(tile, (tile, metadata) => {
                master.emitter.emit('photos', {type: 'update', item: [tile]});
                if(tile.seed) {
                    master.emitter.emit('photoRendered', tile);
                }
            });
        } else {
            master.emitter.on('blobDone-' + tile.infoHash, (photo) => {
                tile.elem = photo.elem;
                this.readMetadata(tile);
            }, this);
        }
    }

    imgLoaded(tile) {
        this.readMetadata(tile);
    }

    removeFile(node) {
        while (node.firstChild) {
            node.removeChild(node.firstChild);
        }
    }

    renderMediaDom(tile, classes) {
        return tile.isImage
            ? <img src={tile.img} alt={tile.fileName}
                   className={classes.wide}
                   onLoad={this.imgLoaded.bind(this, tile)} />
            : <div className={classes.horizontal}>
                {tile.isAudio ? <div className={classes.horizontal}>
                        <Typography variant={"caption"}>Open in</Typography>
                        <IconButton color="primary"
                                    onClick={() => this.openInWebamp()}>

                            <Icon classes={{root: classes.iconRoot}}>
                                <img className={classes.imageIcon} src="./webamp.svg"/>
                            </Icon>
                        </IconButton>
                    </div> : ''}
                    <div style={{
                    width: '100%', marginTop: '10px'}}
                       ref={ref => this.handleContainerLoaded(tile, ref, tile.torrentFile)}>
                    </div>
                {tile.isAudio ? <div ref={ref => this.handleWebamp(tile, ref, tile.torrentFile)}>
                    </div> : ''};
                </div>;
    }

    render() {

        const {tile, classes} = this.props;

        return (<span>
            {this.renderMediaDom(tile, classes)}
        </span>
        );
    }
}

RenderContent.propTypes = {
    tile: PropTypes.object.isRequired,
    master: PropTypes.object.isRequired,
};
export default withSnackbar(withStyles(styles)(RenderContent));