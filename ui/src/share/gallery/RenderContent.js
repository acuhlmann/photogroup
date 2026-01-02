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
        maxWidth: '100%',
        height: 'auto',
        display: 'block',
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
    // Use a ref to access the current tile without including it in dependencies
    const tileRef = useRef(tile);
    tileRef.current = tile;
    
    const readMetadata = useCallback((tileParam) => {
        const currentTile = tileParam || tileRef.current;
        // For seeded images, try to use tile.file if elem is not set
        const elemToUse = currentTile.elem || (currentTile.seed && currentTile.isImage && currentTile.file ? currentTile.file : null);
        if(elemToUse) {
            // Ensure elem is set for metadata reading
            if(!currentTile.elem) {
                currentTile.elem = elemToUse;
            }
            // Ensure img is set for display - but don't recreate if it already exists
            if(currentTile.isImage && !currentTile.img && currentTile.elem) {
                currentTile.img = URL.createObjectURL(currentTile.elem);
            }
            Logger.info('readMetadata called for ' + currentTile.fileName + ' seed=' + currentTile.seed + ' elem=' + !!currentTile.elem);
            master.metadata.readMetadata(currentTile, (tile, metadata) => {
                Logger.info('readMetadata callback for ' + tile.fileName + ' seed=' + tile.seed);
                // Preserve img property when emitting update
                const updateTile = {...tile};
                if(tile.img) {
                    updateTile.img = tile.img;
                }
                master.emitter.emit('photos', {type: 'update', item: [updateTile]});
                if(tile.seed) {
                    Logger.info('Emitting photoRendered for ' + tile.fileName);
                    master.emitter.emit('photoRendered', tile);
                }
            });
        } else {
            Logger.info('readMetadata waiting for blobDone for ' + currentTile.fileName);
            master.emitter.on('blobDone-' + currentTile.infoHash, (photo) => {
                currentTile.elem = photo.elem;
                if(readMetadataRef.current) {
                    readMetadataRef.current(currentTile);
                }
            });
        }
    }, [master]);

    // Store readMetadata in ref
    readMetadataRef.current = readMetadata;

    // Memoize handlers to avoid recreating them on every render
    const handleBlobDone = useCallback((photo) => {
        const currentTile = tileRef.current;
        Logger.info('handleBlobDone ' + photo.fileName);
        currentTile.elem = photo.elem || currentTile.elem;
        // Ensure img is set for images when elem becomes available - but don't recreate if it exists
        if(currentTile.isImage && currentTile.elem && !currentTile.img) {
            currentTile.img = URL.createObjectURL(currentTile.elem);
        }
        // Preserve img property when emitting update
        const updateTile = {...currentTile};
        if(currentTile.img) {
            updateTile.img = currentTile.img;
        }
        master.emitter.emit('photos', {type: 'update', item: [updateTile]});
        // Read metadata when elem is available - this will emit photoRendered for seeded images
        if(readMetadataRef.current) {
            readMetadataRef.current(currentTile);
        }
    }, [master]);

    const handleTorrentReady = useCallback((photos) => {
        const currentTile = tileRef.current;
        // Check if this torrentReady event is for our tile
        const photo = photos.find(p => p.infoHash === currentTile.infoHash);
        if(photo && photo.torrent && !currentTile.torrent) {
            // Torrent just became available, attach the listener
            currentTile.torrent = photo.torrent;
            if(handleDoneRef.current) {
                currentTile.torrent.on('done', handleDoneRef.current);
            }
        }
    }, []);

    const handleDone = useCallback((torrent) => {
        const currentTile = tileRef.current;
        fetch(torrent.torrentFileBlobURL)
            .then(r => r.blob())
            .then(blobFile => new File([blobFile], currentTile.fileName, { type: currentTile.fileType }))
            .then(file => {
                console.log('handleDone torrentFileBlobURL ' + file);
                currentTile.elem = file;
                // Don't recreate img URL if it already exists
                if(currentTile.isImage && !currentTile.img) {
                    currentTile.img = URL.createObjectURL(file);
                }
                master.emitter.emit('photos', {type: 'update', item: [currentTile]});
                if(readMetadataRef.current) {
                    readMetadataRef.current(currentTile);
                }
            });
    }, [master]);

    // Store handleDone in ref so it can be used in handleTorrentReady
    handleDoneRef.current = handleDone;

    const removeFile = useCallback((node) => {
        while (node.firstChild) {
            node.removeChild(node.firstChild);
        }
    }, []);

    // Define doAppendFile and related functions first
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

    const imgLoaded = useCallback(() => {
        // For images, when the img tag loads, try to read metadata
        if(readMetadataRef.current) {
            readMetadataRef.current(tile);
        }
    }, [tile]);

    // Set up event listeners and initialize seeded images
    // Only run this effect when infoHash changes (when a new tile is added)
    useEffect(() => {
        const currentTile = tileRef.current;
        const infoHash = currentTile.infoHash;
        const isSeededImage = currentTile.seed && (currentTile.isImage || (currentTile.fileType && currentTile.fileType.includes('image/')));
        
        emitter.on('blobDone-' + infoHash, handleBlobDone);
        emitter.on('torrentReady', handleTorrentReady);
        
        // Only attach torrent listener if torrent exists (may not be set yet for seeded images)
        if(currentTile.torrent) {
            currentTile.torrent.on('done', handleDone);
        }
        
        // For seeded images, if elem is already set (from mergePostloadMetadata), ensure img is set and read metadata
        if(isSeededImage) {
            // Ensure isImage is set for consistency
            if(!currentTile.isImage) {
                currentTile.isImage = true;
            }
            // Only create img URL if it doesn't exist - don't recreate it
            if(currentTile.elem && !currentTile.img) {
                currentTile.img = URL.createObjectURL(currentTile.elem);
                master.emitter.emit('photos', {type: 'update', item: [currentTile]});
            }
            // If elem is set, read metadata immediately (blobDone may have already fired)
            if(currentTile.elem) {
                Logger.info('useEffect: seeded image has elem, calling readMetadata for ' + currentTile.fileName);
                // Use a small delay to ensure the component is fully mounted
                setTimeout(() => {
                    if(readMetadataRef.current) {
                        readMetadataRef.current(currentTile);
                    }
                }, 0);
            } else if(currentTile.file) {
                // Fallback: use tile.file if elem is not set
                currentTile.elem = currentTile.file;
                if(!currentTile.img) {
                    currentTile.img = URL.createObjectURL(currentTile.file);
                }
                master.emitter.emit('photos', {type: 'update', item: [currentTile]});
                setTimeout(() => {
                    if(readMetadataRef.current) {
                        readMetadataRef.current(currentTile);
                    }
                }, 0);
            }
        }

        // Cleanup function
        return () => {
            emitter.removeListener('blobDone-' + infoHash, handleBlobDone);
            emitter.removeListener('torrentReady', handleTorrentReady);
            // Only remove torrent listener if torrent exists
            const cleanupTile = tileRef.current;
            if(cleanupTile && cleanupTile.torrent) {
                cleanupTile.torrent.removeListener('done', handleDone);
            }
        };
    }, [tile.infoHash]); // Only depend on infoHash - when it changes, it's a new tile

    const renderMediaDom = () => {
        const currentTile = tileRef.current;
        // Ensure img is set if we have elem but no img (defensive check)
        if(currentTile.isImage && currentTile.elem && !currentTile.img) {
            currentTile.img = URL.createObjectURL(currentTile.elem);
        }
        return currentTile.isImage && currentTile.img
            ? <img src={currentTile.img} alt={currentTile.fileName}
                   className={classes?.wide || ''}
                   style={{width: '100%', maxWidth: '100%', height: 'auto', display: 'block'}}
                   onLoad={imgLoaded} 
                   key={currentTile.infoHash} />
            : <div className={classes?.wide || ''} style={{width: '100%', maxWidth: '100%'}}>
                <div className={classes?.horizontal || ''}>
                {currentTile.isAudio ? <div className={classes?.horizontal || ''}>
                        <Typography variant={"caption"}>Open in</Typography>
                        <IconButton color="primary"
                                    onClick={openInWebamp}>

                            <Icon classes={classes?.iconRoot ? {root: classes.iconRoot} : undefined}>
                                <img className={classes?.imageIcon || ''} src="./webamp.svg"/>
                            </Icon>
                        </IconButton>
                    </div> : ''}
                    <div style={{
                    width: '100%', marginTop: '10px'}}
                       ref={ref => handleContainerLoaded(ref, currentTile.torrentFile)}>
                    </div>
                {currentTile.isAudio ? <div ref={ref => handleWebamp(ref, currentTile.torrentFile)}>
                    </div> : ''}
            </div>
            {currentTile.isAudio ? <div className={classes?.wide || ''} ref={registerEqualizerNode}>
            </div> : ''}
        </div>;
    };

    return (
        <div style={{width: '100%', maxWidth: '100%', overflow: 'hidden'}}>
            {renderMediaDom()}
        </div>
    );
}

RenderContent.propTypes = {
    tile: PropTypes.object.isRequired,
    master: PropTypes.object.isRequired,
};
export default withSnackbar(withStyles(styles)(RenderContent));