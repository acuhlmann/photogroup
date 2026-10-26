import { useState, useEffect, useRef } from 'react';
import { loadPreviewUrl, previewUrlOf } from './tilePreview';

/** A clip whose whole file is on this device, so it can play. */
export const playableClip = tile => !!(tile && tile.isVideo && !tile.loading && (tile.elem || tile.file));
/** What a tile can be opened as: a photo to look at or a clip to play. */
export const viewable = tile => !!tile && ((!tile.loading && !!tile.img) || playableClip(tile));
/** The key a tile keeps while it is seeded and its infoHash changes. */
export const keyOf = tile => tile && (tile.tileKey || tile.infoHash);

/** The tile's preview picture (a clip's poster frame), once it is here. */
export function usePreview(tile) {
    const ready = previewUrlOf(tile);
    const [fetched, setFetched] = useState({});
    const key = keyOf(tile);
    useEffect(() => {
        let live = true;
        // The thumbnail comes ahead of the file; a clip without one gets a frame once it is here.
        if (tile && !ready && (tile.torrentFileThumb || (tile.isVideo && !tile.loading))) {
            loadPreviewUrl(tile).then(url => live && url && setFetched({ key, url }));
        }
        return () => { live = false; };
    // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [key, ready, tile && tile.torrentFileThumb, tile && tile.loading]);
    return ready || (fetched.key === key ? fetched.url : null);
}

/** An object URL for the clip's local file while it shows. */
export function useClipUrl(tile) {
    const file = tile && tile.isVideo ? (tile.elem || tile.file) : null;
    const [url, setUrl] = useState(null);
    useEffect(() => {
        if (!(file instanceof Blob) || typeof URL.createObjectURL !== 'function') return undefined;
        const made = URL.createObjectURL(file);
        setUrl(made);
        return () => {
            URL.revokeObjectURL(made);
            setUrl(null);
        };
    }, [file]);
    return url;
}

/** How far along a photo still arriving is, 0 to 100, checked every second. */
export function useArriving(tile) {
    const read = () => (tile && tile.torrentFile ? Math.round((tile.torrentFile.progress || 0) * 100) : 0);
    const [percent, setPercent] = useState(read);
    const loading = !!(tile && tile.loading);
    const torrentFile = tile && tile.torrentFile;
    useEffect(() => {
        setPercent(read());
        if (!loading) return undefined;
        const id = setInterval(() => setPercent(read()), 1000);
        return () => clearInterval(id);
    // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [loading, torrentFile]);
    return percent;
}

const SWIPE = 50;

/**
 * Touch handlers that call `onSwipe(1)` for a swipe to the left (the next
 * photo) and `onSwipe(-1)` for a swipe to the right. Two-finger touches
 * (zoom) and mostly vertical moves don't count.
 */
export function useSwipe(onSwipe) {
    const start = useRef(null);
    return {
        onTouchStart: event => {
            start.current = event.touches.length === 1
                ? { x: event.touches[0].clientX, y: event.touches[0].clientY }
                : null;
        },
        onTouchMove: event => {
            if (event.touches.length > 1) start.current = null;
        },
        onTouchEnd: event => {
            const from = start.current;
            start.current = null;
            const touch = event.changedTouches && event.changedTouches[0];
            if (!from || !touch) return;
            const dx = touch.clientX - from.x;
            const dy = touch.clientY - from.y;
            if (Math.abs(dx) < SWIPE || Math.abs(dx) < Math.abs(dy) * 1.5) return;
            onSwipe(dx < 0 ? 1 : -1);
        },
    };
}
