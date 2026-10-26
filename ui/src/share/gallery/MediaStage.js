import React, { useEffect } from 'react';
import PropTypes from 'prop-types';
import Box from '@mui/material/Box';
import Typography from '@mui/material/Typography';
import IconButton from '@mui/material/IconButton';
import CircularProgress from '@mui/material/CircularProgress';
import ArrowBackRounded from '@mui/icons-material/ArrowBackRounded';
import ArrowForwardRounded from '@mui/icons-material/ArrowForwardRounded';
import AudiotrackRounded from '@mui/icons-material/AudiotrackRounded';
import { keyOf, playableClip, useArriving, useClipUrl, usePreview, useSwipe } from './mediaView';

const roundButton = { position: 'absolute', color: '#fff', bgcolor: 'rgba(0,0,0,0.5)', '&:hover': { bgcolor: 'rgba(0,0,0,0.7)' } };

/**
 * One photo or clip as large as the space allows, on black. Swipe, the
 * arrow buttons or the arrow keys go to the previous or next one. A photo
 * still arriving shows its preview and how far along it is.
 */
function MediaStage({ tile, onStep, hasPrev, hasNext, children }) {
    const clipUrl = useClipUrl(tile);
    const poster = usePreview(tile);
    const percent = useArriving(tile);
    const swipe = useSwipe(step => ((step < 0 ? hasPrev : hasNext) && onStep(step)));

    useEffect(() => {
        const onKey = event => {
            const tag = event.target && event.target.tagName;
            // A focused clip seeks with the arrow keys; leave them to it.
            if (tag === 'INPUT' || tag === 'TEXTAREA' || tag === 'VIDEO') return;
            if (event.key === 'ArrowLeft' && hasPrev) onStep(-1);
            if (event.key === 'ArrowRight' && hasNext) onStep(1);
        };
        window.addEventListener('keydown', onKey);
        return () => window.removeEventListener('keydown', onKey);
    }, [onStep, hasPrev, hasNext]);

    // Fill the space, so a small photo or a preview shows large too.
    const fit = { width: '100%', height: '100%', objectFit: 'contain', display: 'block' };
    let media;
    if (!tile.loading && tile.img) {
        media = <Box component="img" src={tile.img} alt={tile.fileName || 'Photo'} sx={fit} />;
    } else if (playableClip(tile)) {
        media = (
            <Box component="video" key={keyOf(tile)} src={clipUrl || undefined}
                poster={poster || undefined} controls playsInline
                aria-label={tile.fileName || 'Clip'} sx={fit} />
        );
    } else if (poster) {
        media = (
            <Box component="img" src={poster} alt={tile.fileName || (tile.isVideo ? 'Clip' : 'Photo')}
                sx={{ ...fit, filter: tile.previewOnly ? 'none' : 'brightness(0.6)' }} />
        );
    } else if (tile.isAudio) {
        media = <AudiotrackRounded sx={{ fontSize: 96, color: 'rgba(255,255,255,0.6)' }} />;
    }

    return (
        <Box {...swipe} data-testid="media-stage" sx={{
            position: 'relative', flex: 1, minHeight: 0, width: '100%',
            display: 'flex', alignItems: 'center', justifyContent: 'center',
            bgcolor: '#000', overflow: 'hidden', touchAction: 'pan-y pinch-zoom',
        }}>
            {media}
            {tile.loading && !tile.previewOnly && (
                <Box sx={{ position: 'absolute', display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 1, color: '#fff' }}>
                    <CircularProgress variant={percent > 0 ? 'determinate' : 'indeterminate'} value={percent} size={48} sx={{ color: '#fff' }} />
                    <Typography variant="body2">{percent > 0 ? `Arriving · ${percent}%` : 'Arriving…'}</Typography>
                </Box>
            )}
            {hasPrev && (
                <IconButton aria-label="Previous" onClick={() => onStep(-1)} sx={{ ...roundButton, left: 8 }}>
                    <ArrowBackRounded />
                </IconButton>
            )}
            {hasNext && (
                <IconButton aria-label="Next" onClick={() => onStep(1)} sx={{ ...roundButton, right: 8 }}>
                    <ArrowForwardRounded />
                </IconButton>
            )}
            {children}
        </Box>
    );
}

MediaStage.propTypes = {
    tile: PropTypes.object.isRequired,
    onStep: PropTypes.func.isRequired,
    hasPrev: PropTypes.bool,
    hasNext: PropTypes.bool,
    children: PropTypes.node,
};

export default MediaStage;
