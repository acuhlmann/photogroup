import React, { useEffect, useRef, useCallback, useState } from 'react';
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
import { imageAspectRatio, rememberImageSize } from "./imageSize";
import { loadPreviewUrl } from "./tilePreview";
import { captureFrame } from "../util/videoFrame";

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

/**
 * Give a clip something to look at before anyone presses play. The thumbnail
 * that came with the share is the cheap route, but a clip this device just
 * uploaded has no such file - it holds the original, not the torrent's
 * `Thumbnail …` - so a frame is grabbed from the bytes in hand. With neither,
 * the element is seeked a hair into its own stream, which is what makes a
 * browser paint a first frame at all instead of an empty box and a control bar.
 */
function showFirstFrame(tile, elem) {
    const paint = () => {
        if (elem.poster) return;
        const nudge = () => {
            if (elem.poster || elem.currentTime > 0) return;
            try { elem.currentTime = 0.1; } catch { /* nothing to seek yet */ }
        };
        if (elem.readyState >= 1) nudge();
        else elem.addEventListener('loadedmetadata', nudge, { once: true });
    };
    loadPreviewUrl(tile).then(url => {
        if (url) {
            elem.poster = url;
            return;
        }
        const src = elem.dataset.objectUrl;
        if (!src) {
            paint();
            return;
        }
        captureFrame(src, { maxSide: 320 }).then(canvas => {
            if (canvas && !elem.poster) {
                try {
                    elem.poster = canvas.toDataURL('image/jpeg', 0.7);
                    return;
                } catch { /* a tainted canvas simply leaves no poster */ }
            }
            paint();
        }, paint);
    });
}

export const CAN_NOT_PLAY = 'This browser cannot play this clip. Save it and open it in another app.';

// WebTorrent 2+ dropped File#appendTo. Play the local copy when we have one
// (the uploader always does), otherwise wait for the download and play its blob.
// A clip shows its poster frame meanwhile, so nobody stares at an empty box.
export function renderMedia(tile, file, node, opts, callback) {
    if (typeof file.appendTo === 'function') {
        try {
            file.appendTo(node, opts, callback);
        } catch (err) {
            callback(err);
        }
        return;
    }
    const elem = document.createElement(tile.isAudio ? 'audio' : 'video');
    elem.autoplay = opts.autoplay;
    elem.controls = true;
    elem.muted = opts.muted;
    elem.loop = opts.loop;
    elem.playsInline = true;
    if (tile.isVideo) {
        elem.preload = 'metadata';
    }
    if (tile.isVideo) {
        // This browser can't decode the clip (an iPhone's HEVC clip on Linux,
        // say). Keep the box with its poster and say why it does not play.
        elem.addEventListener('error', () => {
            if (!node.isConnected || node.querySelector('[data-can-not-play]')) return;
            const note = document.createElement('div');
            note.dataset.canNotPlay = 'true';
            note.style.cssText = 'padding:8px 12px;font-size:0.8rem;text-align:center;opacity:0.8';
            note.textContent = CAN_NOT_PLAY;
            node.appendChild(note);
            if (!elem.poster) elem.style.minHeight = '120px';
        }, { once: true });
    }
    const local = tile.elem || tile.file;
    if (!local) node.appendChild(elem);
    Promise.resolve(local || file.blob())
        .then(blob => {
            if (!node.isConnected) return;
            elem.dataset.objectUrl = URL.createObjectURL(blob);
            elem.src = elem.dataset.objectUrl;
            if (elem.parentNode !== node) node.appendChild(elem);
            if (tile.isVideo) showFirstFrame(tile, elem);
            callback(null, elem);
        })
        .catch(err => {
            elem.remove();
            callback(err);
        });
}

/**
 * Render images or media players and request metadata as content becomes available.
 * Image previews remain until decoding succeeds; a decode failure keeps the preview.
 * `playbackActive` defaults to true; false skips attaching inline audio/video players.
 */
function RenderContent(props) {
    const {master, tile, classes, enqueueSnackbar, closeSnackbar, playbackActive = true} = props;
    const emitter = master.emitter;
    
    // Use refs for instance variables
    const webampRef = useRef(null);
    const webampNodeRef = useRef(null);
    const equalizerNodeRef = useRef(null);
    const mediaContainerRef = useRef(null);
    const openedWebampRef = useRef(false);
    const handleDoneRef = useRef(null);
    const readMetadataRef = useRef(null);
    // Which image load finished decoding. Each source change starts a new
    // generation, so the preview returns at once and a late decode of an
    // earlier load (even of the same URL) can't hide it.
    const [decoded, setDecoded] = useState(null);
    const imgGenRef = useRef({ src: tile.img, gen: 0 });
    if (imgGenRef.current.src !== tile.img) {
        imgGenRef.current = { src: tile.img, gen: imgGenRef.current.gen + 1 };
    }

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
        } else if (currentTile.isVideo && (currentTile.torrentFile || currentTile.file)) {
            Logger.info('readMetadata streaming media for ' + currentTile.fileName);
            master.metadata.readMetadata(currentTile, (tile, metadata) => {
                const updateTile = {...tile};
                master.emitter.emit('photos', {type: 'update', item: [updateTile]});
                if (tile.seed) {
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
            if (node.firstChild.dataset?.objectUrl) {
                URL.revokeObjectURL(node.firstChild.dataset.objectUrl);
            }
            node.removeChild(node.firstChild);
        }
    }, []);

    // Define doAppendFile and related functions first
    const doAppendFile = useCallback((tile, file, node) => {
        const opts = {
            autoplay: false,
            controls: tile.isVideo,
            muted: tile.isVideo,
            loop: tile.isVideo,
        };

        // A clip that came from the server copy has the file, not a torrent file.
        const size = tile.torrentFile ? tile.torrentFile.length : file.size;
        if(FileUtil.largerThanMaxBlobSize(size)) {
            const msg = 'File is ' + FileUtil.formatBytes(size) + ' and too large to show here. Download it.';
            Logger.warn(msg);
            // Say so, over the clip's poster when it has one, instead of an empty box.
            const note = document.createElement('div');
            note.style.cssText = 'position:relative;width:100%;text-align:center';
            const caption = document.createElement('div');
            caption.style.cssText = 'padding:12px;font-size:0.85rem';
            caption.textContent = FileUtil.formatBytes(size) + ' is too big to play here. Save it to watch.';
            note.appendChild(caption);
            loadPreviewUrl(tile).then(url => {
                if (!url) return;
                const poster = document.createElement('img');
                poster.src = url;
                poster.alt = tile.fileName || '';
                poster.style.cssText = 'width:100%;display:block;filter:brightness(0.6)';
                note.prepend(poster);
                caption.style.cssText += ';position:absolute;left:0;right:0;bottom:12px;color:#fff';
            });
            node.appendChild(note);
        } else {
            renderMedia(tile, file, node, opts, (err, elem) => {
                if (err) {
                    const msgNode = document.createElement("div");
                    const msgNodeText = document.createTextNode(err.message);
                    msgNode.appendChild(msgNodeText);
                    node.appendChild(msgNode);

                    Logger.error('renderMedia ' + err.message);
                    enqueueSnackbar(err.message, {
                        variant: 'error',
                        persist: false,
                        autoHideDuration: 4000,
                        action: (key) => (<Button className={classes.white} onClick={ () => closeSnackbar(key) } size="small">x</Button>),
                    });
                    return;
                }

                Logger.info('New DOM node with the content', elem);
                if(elem && elem.style) {
                    elem.style.width = '100%';
                    if(!tile.isAudio) {
                        // Width alone leaves a video at its 150px default height
                        // rather than the clip's own ratio, so the player looked
                        // broken until it was already playing.
                        elem.style.height = 'auto';
                        elem.style.display = 'block';
                    }
                }

                if(tile.isVideo) {
                    if (elem) {
                        elem.loop = true;
                        elem.controls = true;
                        elem.playsInline = true;
                    }
                    master.metadata.readMetadata(tile, (updatedTile) => {
                        const updateTile = {...updatedTile};
                        master.emitter.emit('photos', {type: 'update', item: [updateTile]});
                        if (updatedTile.seed) {
                            master.emitter.emit('photoRendered', updatedTile);
                        }
                    });
                } else if(tile.isAudio) {
                    if (getBlobAndReadMetadataRef.current) {
                        getBlobAndReadMetadataRef.current(tile);
                    }
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
        if(!playbackActive || !tile || !file || !node) {
            return;
        }

        mediaContainerRef.current = node;

        // A clip delivered from the server copy may have no torrent, only its
        // file. Keyed apart, so a player still waiting on a stalled torrent
        // is swapped for the delivered file.
        const baseHash = tile.torrent?.infoHash || (tile.torrentFile ? null : tile.infoHash);
        const tileInfoHash = baseHash && (tile.fromServerCopy ? baseHash + ':server' : baseHash);
        // Claim the node before appending, not after the element lands: the
        // player is attached in a promise, so a re-render while it was still in
        // flight found an empty node and started a second one for the same
        // photo - two control bars, two blob URLs, neither sized.
        if(!tileInfoHash || node.infoHash === tileInfoHash) {
            return;
        }
        if(node.infoHash) {
            removeFile(node);
        }
        node.infoHash = tileInfoHash;
        appendFile(tile, node, file);
    }, [playbackActive, tile, removeFile, appendFile]);

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
        if (tile.isVideo && tile.torrentFile) {
            if (readMetadataRef.current) {
                readMetadataRef.current(tile);
            }
            return;
        }
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

    /** Record image dimensions, request metadata, and retire the preview after decoding succeeds. */
    const imgLoaded = useCallback((event) => {
        const img = event?.target;
        if (!img) return;
        rememberImageSize(tile, img);
        // Keep the preview behind the photo until it is decoded, otherwise a
        // large photo paints as an empty box for a few frames.
        const gen = imgGenRef.current.gen;
        const decoding = typeof img.decode === 'function' ? img.decode() : Promise.resolve();
        // A failed decode keeps the preview rather than revealing a broken image.
        decoding.then(() => setDecoded(gen), () => {});
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
        // Local file metadata only — torrent metadata runs after appendTo so it does not
        // compete with the video/audio read stream used for playback.
        if ((currentTile.isVideo || currentTile.isAudio) && !currentTile.hasMetadata
            && (currentTile.file || currentTile.elem) && !currentTile.torrentFile) {
            if (readMetadataRef.current) {
                readMetadataRef.current(currentTile);
            }
        }

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
            const container = mediaContainerRef.current;
            if (container) {
                removeFile(container);
                container.infoHash = null;
                mediaContainerRef.current = null;
            }
        };
    }, [tile.infoHash]); // Only depend on infoHash - when it changes, it's a new tile

    // A poster the room sent later (another device grabbed a frame this one could not).
    useEffect(() => {
        const video = tile.poster && mediaContainerRef.current && mediaContainerRef.current.querySelector('video');
        if (video && !video.poster) video.poster = tile.poster;
    }, [tile.poster]);

    /** Render the current image with its preview during decoding, or an audio/video container. */
    const renderMediaDom = () => {
        const currentTile = tileRef.current;
        // Ensure img is set if we have elem but no img (defensive check)
        if(currentTile.isImage && currentTile.elem && !currentTile.img) {
            currentTile.img = URL.createObjectURL(currentTile.elem);
        }
        return currentTile.isImage && currentTile.img
            ? <img src={currentTile.img} alt={currentTile.fileName}
                   className={classes?.wide || ''}
                   // Reserve the size the loading preview measured so the
                   // tile doesn't collapse while the full image decodes.
                   style={{width: '100%', maxWidth: '100%', height: 'auto', display: 'block',
                       aspectRatio: imageAspectRatio(currentTile), backgroundColor: '#3a3f47',
                       ...(decoded !== imgGenRef.current.gen && currentTile.previewUrl ? {
                           backgroundImage: `url(${currentTile.previewUrl})`,
                           backgroundSize: 'cover',
                           backgroundPosition: 'center',
                       } : null)}}
                   onLoad={imgLoaded} 
                   key={currentTile.tileKey || currentTile.infoHash} />
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
                       ref={ref => handleContainerLoaded(ref, (currentTile.fromServerCopy && currentTile.elem) || currentTile.torrentFile)}>
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
