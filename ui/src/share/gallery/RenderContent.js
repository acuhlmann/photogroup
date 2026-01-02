import React, { useEffect, useRef, useCallback } from 'react';
import {withStyles} from '@mui/styles';
import Typography from "@mui/material/Typography";
import IconButton from "@mui/material/IconButton";
import Logger from "js-logger";
import update from "immutability-helper";
import Button from "@mui/material/Button";
import Webamp from 'webamp';
import {Icon} from "@mui/material";
import { withSnackbar } from '../compatibility/withSnackbar';
import PropTypes from "prop-types";
import AudioMotionAnalyzer from 'audiomotion-analyzer';
import FileUtil from "../util/FileUtil";

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

function RenderContent(props) {
    const {master, tile, classes, enqueueSnackbar, closeSnackbar} = props;
    const emitter = master.emitter;
    
    // Use refs for instance variables
    const webampRef = useRef(null);
    const webampNodeRef = useRef(null);
    const equalizerNodeRef = useRef(null);
    const openedWebampRef = useRef(false);
    const handleDoneRef = useRef(null);
    const readMetadataRef = useRef(null);

    // Define readMetadata first so it can be used by other callbacks
    const readMetadata = useCallback((tile) => {
        // For seeded images, try to use tile.file if elem is not set
        const elemToUse = tile.elem || (tile.seed && tile.isImage && tile.file ? tile.file : null);
        if(elemToUse) {
            // Ensure elem is set for metadata reading
            if(!tile.elem) {
                tile.elem = elemToUse;
            }
            // Ensure img is set for display
            if(tile.isImage && !tile.img && tile.elem) {
                tile.img = URL.createObjectURL(tile.elem);
            }
            Logger.info('readMetadata called for ' + tile.fileName + ' seed=' + tile.seed + ' elem=' + !!tile.elem);
            master.metadata.readMetadata(tile, (tile, metadata) => {
                Logger.info('readMetadata callback for ' + tile.fileName + ' seed=' + tile.seed);
                master.emitter.emit('photos', {type: 'update', item: [tile]});
                if(tile.seed) {
                    Logger.info('Emitting photoRendered for ' + tile.fileName);
                    master.emitter.emit('photoRendered', tile);
                }
            });
        } else {
            Logger.info('readMetadata waiting for blobDone for ' + tile.fileName);
            master.emitter.on('blobDone-' + tile.infoHash, (photo) => {
                tile.elem = photo.elem;
                if(readMetadataRef.current) {
                    readMetadataRef.current(tile);
                }
            });
        }
    }, [tile, master]);

    // Store readMetadata in ref
    readMetadataRef.current = readMetadata;

    // Memoize handlers to avoid recreating them on every render
    const handleBlobDone = useCallback((photo) => {
        Logger.info('handleBlobDone ' + photo.fileName);
        tile.elem = photo.elem || tile.elem;
        // Ensure img is set for images when elem becomes available
        if(tile.isImage && tile.elem && !tile.img) {
            tile.img = URL.createObjectURL(tile.elem);
        }
        master.emitter.emit('photos', {type: 'update', item: [tile]});
        // Read metadata when elem is available - this will emit photoRendered for seeded images
        if(readMetadataRef.current) {
            readMetadataRef.current(tile);
        }
    }, [tile, master]);

    const handleTorrentReady = useCallback((photos) => {
        // Check if this torrentReady event is for our tile
        const photo = photos.find(p => p.infoHash === tile.infoHash);
        if(photo && photo.torrent && !tile.torrent) {
            // Torrent just became available, attach the listener
            tile.torrent = photo.torrent;
            if(handleDoneRef.current) {
                tile.torrent.on('done', handleDoneRef.current);
            }
        }
    }, [tile]);

    const handleDone = useCallback((torrent) => {
        fetch(torrent.torrentFileBlobURL)
            .then(r => r.blob())
            .then(blobFile => new File([blobFile], tile.fileName, { type: tile.fileType }))
            .then(file => {
                console.log('handleDone torrentFileBlobURL ' + file);
                tile.elem = file;
                master.emitter.emit('photos', {type: 'update', item: [tile]});
                if(readMetadataRef.current) {
                    readMetadataRef.current(tile);
                }
            });
    }, [tile, master]);

    // Store handleDone in ref so it can be used in handleTorrentReady
    handleDoneRef.current = handleDone;

    const removeFile = useCallback((node) => {
        while (node.firstChild) {
            node.removeChild(node.firstChild);
        }
    }, []);

    const handleContainerLoaded = useCallback((node, file) => {
        if(!tile || !file || !node) {
            return;
        }

        if(node.hasChildNodes()) {
            const tileInfoHash = tile.torrent?.infoHash;
            const nodeInfoHash = node.infoHash;
            if(tileInfoHash && tileInfoHash !== nodeInfoHash) {
                removeFile(node);
                node.infoHash = tile.torrent.infoHash;
                appendFile(tile, node, file);
            }
            return;
        }

        if(tile.torrent) {
            node.infoHash = tile.torrent.infoHash;
            appendFile(tile, node, file);
        }
    }, [tile, removeFile, appendFile]);

    const handleWebamp = useCallback((node, file) => {
        if(!tile || !file || !node || !tile.isAudio) {
            return;
        }

        if(!Webamp.browserIsSupported()) {
            Logger.error("Oh no! Webamp does not work!");
            throw new Error("What's the point of anything?");
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
        webampRef.current = webamp;
        webampNodeRef.current = node;
    }, [tile]);

    const registerEqualizerNode = useCallback((node) => {
        if(!node) {
            return;
        }
        equalizerNodeRef.current = node;
    }, []);

    const openInWebamp = useCallback(() => {
        const webamp = webampRef.current;
        const elem = tile.elem;
        if(!openedWebampRef.current) {
            if(elem && webamp) {
                openedWebampRef.current = true;
                webamp.appendTracks([{blob: elem}]);
                webamp.renderWhenReady(webampNodeRef.current).then(() => {
                    webamp.play();
                });
            }
        } else if(webamp) {
            webamp.setTracksToPlay([{blob: elem}]);
            webamp.reopen();
        }
    }, [tile]);

    const doAppendFile = useCallback((tile, file, node) => {
        const opts = {
            autoplay: !tile.isAudio,
            muted: !tile.isAudio, loop: true,
        };

        if(FileUtil.largerThanMaxBlobSize(tile.torrentFile.length)) {
            const msg = 'File is ' + FileUtil.formatBytes(tile.torrentFile.length) + ' and too large to render inline, just download instead.';
            Logger.warn(msg);
        } else {
            file.appendTo(node, opts, (err, elem) => {
                if (err) {
                    const msgNode = document.createElement("div");
                    const msgNodeText = document.createTextNode(err.message);
                    msgNode.appendChild(msgNodeText);
                    node.appendChild(msgNode);

                    Logger.error('webtorrent.appendTo ' + err.message);
                    enqueueSnackbar(err.message, {
                        variant: 'error',
                        persist: false,
                        autoHideDuration: 4000,
                        action: (key) => (<Button className={classes.white} onClick={ () => closeSnackbar(key) } size="small">x</Button>),
                    });
                }

                Logger.info('New DOM node with the content', elem);
                if(elem && elem.style) {
                    elem.style.width = '100%';
                }

                if(getBlobAndReadMetadataRef.current) {
                    getBlobAndReadMetadataRef.current(tile);
                }

                if(tile.isVideo) {
                    if(elem) {
                        elem.loop = true;
                    }
                } else if(tile.isAudio) {
                    const audioMotion = new AudioMotionAnalyzer(
                        equalizerNodeRef.current,
                        {
                            source: elem,
                            showScale: false,
                            start: false
                        }
                    );
                    equalizerNodeRef.current.style.display = 'none';
                    elem.addEventListener('play', () => {
                        equalizerNodeRef.current.style.display = '';
                        audioMotion.toggleAnalyzer(true);
                    });
                    elem.addEventListener('pause', () => {
                        equalizerNodeRef.current.style.display = 'none';
                        audioMotion.toggleAnalyzer(false);
                    });
                }
            });
        }
    }, [tile, classes, enqueueSnackbar, closeSnackbar]);

    const getBlobAndReadMetadata = useCallback((tile) => {
        Logger.info('streaming done ' + tile.torrentFile?.progress);
        if(tile.elem) {
            Logger.info('streaming getBlob ' + tile.torrentFile);
            if(readMetadataRef.current) {
                readMetadataRef.current(tile);
            }
        } else {
            master.emitter.on('blobDone-' + tile.infoHash, (photo) => {
                Logger.info('getBlobAndReadMetadata blobDone ' + tile.fileName);
                if(!tile.elem) {
                    tile.elem = photo.elem;
                    if(readMetadataRef.current) {
                        readMetadataRef.current(tile);
                    }
                }
            });
        }
    }, [tile, master]);

    const getBlobAndReadMetadataRef = useRef(null);
    getBlobAndReadMetadataRef.current = getBlobAndReadMetadata;

    const doAppendFileRef = useRef(null);
    doAppendFileRef.current = doAppendFile;

    const appendFile = useCallback((tile, node, file) => {
        if(tile.secure) {
            const opts = {'announce': window.WEBTORRENT_ANNOUNCE, private: true};
            master.client.seed(tile.file, opts, (torrent) => {
                if(doAppendFileRef.current) {
                    doAppendFileRef.current(tile, torrent.files[0], node);
                }
            });
        } else {
            if(doAppendFileRef.current) {
                doAppendFileRef.current(tile, file, node);
            }
            Logger.info('streaming start ' + tile.torrentFile?.progress);
        }
    }, [tile, master]);

    const imgLoaded = useCallback(() => {
        // For images, when the img tag loads, try to read metadata
        if(readMetadataRef.current) {
            readMetadataRef.current(tile);
        }
    }, [tile]);

    // Set up event listeners and initialize seeded images
    useEffect(() => {
        const infoHash = tile.infoHash;
        const isSeededImage = tile.seed && (tile.isImage || (tile.fileType && tile.fileType.includes('image/')));
        
        emitter.on('blobDone-' + infoHash, handleBlobDone);
        emitter.on('torrentReady', handleTorrentReady);
        
        // Only attach torrent listener if torrent exists (may not be set yet for seeded images)
        if(tile.torrent) {
            tile.torrent.on('done', handleDone);
        }
        
        // For seeded images, if elem is already set (from mergePostloadMetadata), ensure img is set and read metadata
        if(isSeededImage) {
            // Ensure isImage is set for consistency
            if(!tile.isImage) {
                tile.isImage = true;
            }
            if(tile.elem && !tile.img) {
                tile.img = URL.createObjectURL(tile.elem);
                master.emitter.emit('photos', {type: 'update', item: [tile]});
            }
            // If elem is set, read metadata immediately (blobDone may have already fired)
            if(tile.elem) {
                Logger.info('useEffect: seeded image has elem, calling readMetadata for ' + tile.fileName);
                if(readMetadataRef.current) {
                    readMetadataRef.current(tile);
                }
            } else if(tile.file) {
                // Fallback: use tile.file if elem is not set
                tile.elem = tile.file;
                if(!tile.img) {
                    tile.img = URL.createObjectURL(tile.file);
                }
                master.emitter.emit('photos', {type: 'update', item: [tile]});
                if(readMetadataRef.current) {
                    readMetadataRef.current(tile);
                }
            }
        }

        // Cleanup function
        return () => {
            emitter.removeListener('blobDone-' + infoHash, handleBlobDone);
            emitter.removeListener('torrentReady', handleTorrentReady);
            // Only remove torrent listener if torrent exists
            if(tile.torrent) {
                tile.torrent.removeListener('done', handleDone);
            }
        };
    }, [tile.infoHash, tile.seed, tile.isImage, tile.fileType, tile.elem, tile.file, tile.img, tile.torrent, emitter, handleBlobDone, handleTorrentReady, handleDone, readMetadata, master, tile.fileName]);

    const renderMediaDom = () => {
        return tile.isImage
            ? <img src={tile.img} alt={tile.fileName}
                   className={classes.wide}
                   onLoad={imgLoaded} />
            : <div className={classes.wide}>
                <div className={classes.horizontal}>
                {tile.isAudio ? <div className={classes.horizontal}>
                        <Typography variant={"caption"}>Open in</Typography>
                        <IconButton color="primary"
                                    onClick={openInWebamp}>

                            <Icon classes={{root: classes.iconRoot}}>
                                <img className={classes.imageIcon} src="./webamp.svg"/>
                            </Icon>
                        </IconButton>
                    </div> : ''}
                    <div style={{
                    width: '100%', marginTop: '10px'}}
                       ref={ref => handleContainerLoaded(ref, tile.torrentFile)}>
                    </div>
                {tile.isAudio ? <div ref={ref => handleWebamp(ref, tile.torrentFile)}>
                    </div> : ''}
            </div>
            {tile.isAudio ? <div className={classes.wide} ref={registerEqualizerNode}>
            </div> : ''}
        </div>;
    };

    return (
        <span>
            {renderMediaDom()}
        </span>
    );
}

RenderContent.propTypes = {
    tile: PropTypes.object.isRequired,
    master: PropTypes.object.isRequired,
};
export default withSnackbar(withStyles(styles)(RenderContent));