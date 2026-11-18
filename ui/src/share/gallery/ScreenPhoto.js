import React, { useEffect, useState } from 'react';
import PropTypes from 'prop-types';
import { previewUrlOf } from './tilePreview';
import { GRID_SIDE, PREVIEW_COPY, loadSmallImage, screenSide, seeThrough, smallImageOf, useSmallImage } from './smallImage';

const keyOfTile = tile => tile && (tile.tileKey || tile.infoHash || tile.img);

/** Whether the page is pinch-zoomed in (a phone's two-finger zoom). */
function usePinched() {
    const scaled = () => typeof window !== 'undefined' && !!window.visualViewport && window.visualViewport.scale > 1.05;
    const [pinched, setPinched] = useState(scaled);
    useEffect(() => {
        const viewport = typeof window !== 'undefined' && window.visualViewport;
        if (!viewport) return undefined;
        // A boolean, so the many resizes of one pinch redraw at most once.
        const onResize = () => setPinched(viewport.scale > 1.05);
        viewport.addEventListener('resize', onResize);
        return () => viewport.removeEventListener('resize', onResize);
    }, []);
    return pinched;
}

// The copies decoded ahead, kept so the browser keeps their pixels: at most
// the photos either side of the one shown.
const warmed = [];
/** Decode a copy ahead, so the photo is sharp in the first frame it shows, not soft for a moment. */
function warm(url) {
    if (!url || typeof Image !== 'function' || warmed.some(img => img.src === url)) return;
    const img = new Image();
    img.decoding = 'async';
    img.src = url;
    warmed.push(img);
    if (warmed.length > 2) warmed.shift();
    if (typeof img.decode === 'function') img.decode().catch(() => {});
}

/**
 * One photo as large as the space allows, for full screen views (the
 * Photographer and geek viewer, and simple mode's). It shows a copy the size
 * of this screen (see screenSide), made off the main thread, not the whole
 * photo; zoomed in with two fingers, the whole photo comes in, and stays for
 * that photo. The sharpest small copy already made (or the share's preview,
 * or `preview`) shows first and stays behind an opaque photo, so a moment
 * the browser has not drawn the photo shows that copy, never a black box.
 * A 50 MP photo drawn whole is 200 MB of pixels: an unfolded foldable lets
 * go of it and draws it again from nothing, which is the black flicker seen
 * in simple mode. Once its own copy is here, the copies of `neighbours` are
 * made, so a swipe shows the next photo sharp at once.
 */
function ScreenPhoto({ tile, neighbours = [], preview: fallback = null, alt, testId, style }) {
    const [side] = useState(screenSide);
    const shown = !!(tile && tile.img && !tile.loading);
    // Urgent: on quick swipes, the photo on screen goes before the ones swiped past.
    const screenCopy = useSmallImage(shown ? tile : null, side, { urgent: true });
    const pinched = usePinched();
    const [wholeFor, setWholeFor] = useState(null);
    // The source a see-through photo was last drawn from: nothing goes behind it again.
    const [drawn, setDrawn] = useState(null);
    const tileKey = keyOfTile(tile);
    useEffect(() => {
        if (pinched && tileKey != null) setWholeFor(tileKey);
    }, [pinched, tileKey]);
    const whole = pinched || (wholeFor != null && wholeFor === tileKey);

    // Not before this photo's copy is here: quick swipes never pile up work
    // in front of the photo shown. (The whole photos either side used to be
    // decoded: 600 MB of pixels for three 50 MP photos.)
    const copyReady = !!screenCopy;
    const [next, previous] = neighbours;
    useEffect(() => {
        if (!copyReady) return;
        [next, previous]
            .filter(near => near && near.isImage && near.img && !near.loading)
            .forEach(near => { loadSmallImage(near, side).then(warm, () => {}); });
    }, [next, previous, copyReady, side]);

    if (!shown) return null;

    const preview = smallImageOf(tile, Math.max(GRID_SIDE, PREVIEW_COPY))
        || smallImageOf(tile, Math.min(GRID_SIDE, PREVIEW_COPY))
        || previewUrlOf(tile) || fallback;
    // The screen's copy, else the small one until it is made; the whole photo
    // when zoomed in, or when there is nothing smaller.
    const src = whole ? tile.img : (screenCopy || preview || tile.img);
    const behind = whole ? (screenCopy || preview) : preview;
    const clear = seeThrough(tile);
    const showBehind = !!behind && behind !== src && !(clear && drawn === src);
    return (
        <img
            // One element per photo: a sharper source for the same photo
            // replaces the softer one in place, with no empty frame between.
            // (Keyed by the photo's URL before, so a new URL for the same
            // photo made a new, empty element.)
            key={tileKey}
            src={src}
            alt={alt || tile.fileName || 'Photo'}
            data-testid={testId}
            decoding="async"
            style={{
                width: '100%',
                height: '100%',
                objectFit: 'contain',
                display: 'block',
                ...style,
                ...(showBehind ? {
                    backgroundImage: `url(${behind})`,
                    backgroundSize: 'contain',
                    backgroundPosition: 'center',
                    backgroundRepeat: 'no-repeat',
                } : null),
            }}
            onLoad={clear ? event => {
                const img = event.currentTarget;
                const loaded = img.getAttribute('src');
                // Noted by source, so a copy that comes in later does not go back behind it.
                const done = () => setDrawn(loaded);
                // A failed decode keeps the preview, so the screen is never blank.
                if (typeof img.decode === 'function') img.decode().then(done, () => {});
                else done();
            } : undefined}
        />
    );
}

ScreenPhoto.propTypes = {
    tile: PropTypes.object,
    neighbours: PropTypes.array,
    preview: PropTypes.string,
    alt: PropTypes.string,
    testId: PropTypes.string,
    style: PropTypes.object,
};

export default ScreenPhoto;
