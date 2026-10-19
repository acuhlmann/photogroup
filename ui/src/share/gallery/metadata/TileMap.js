import React, { useRef } from 'react';
import PropTypes from 'prop-types';
import Box from '@mui/material/Box';
import PlaceRounded from '@mui/icons-material/PlaceRounded';
import { fromTilePosition, tilePosition } from './geo';

const TILE = 256;

/**
 * OpenStreetMap tiles centred on a point, with a pin in the middle. With
 * `onPan`, dragging moves the map under the pin and reports the new centre,
 * which is how a place is picked.
 */
function TileMap({ lat, long, zoom, height = 168, maxWidth = 512, showPin = true, attributionLink = true, onPan, children }) {
    const drag = useRef(null);
    const { x, y } = tilePosition(lat, long, zoom);
    const scale = 2 ** zoom;
    const tiles = [];
    // Enough tiles around the centre to fill the box at any width up to maxWidth.
    const spanX = Math.ceil(maxWidth / 2 / TILE) + 1;
    const spanY = Math.ceil(height / 2 / TILE) + 1;
    for (let dy = -spanY; dy <= spanY; dy++) {
        for (let dx = -spanX; dx <= spanX; dx++) {
            const tx = Math.floor(x) + dx;
            const ty = Math.floor(y) + dy;
            if (ty < 0 || ty >= scale) continue;
            tiles.push({
                key: `${dx},${dy}`,
                left: (tx - x) * TILE,
                top: (ty - y) * TILE,
                src: `https://tile.openstreetmap.org/${zoom}/${((tx % scale) + scale) % scale}/${ty}.png`,
            });
        }
    }

    const handlers = onPan ? {
        onPointerDown: event => {
            event.currentTarget.setPointerCapture?.(event.pointerId);
            drag.current = { pointerX: event.clientX, pointerY: event.clientY, x, y };
        },
        onPointerMove: event => {
            if (!drag.current) return;
            const start = drag.current;
            const next = fromTilePosition(
                start.x - (event.clientX - start.pointerX) / TILE,
                start.y - (event.clientY - start.pointerY) / TILE,
                zoom);
            onPan(next.lat, next.long);
        },
        onPointerUp: () => { drag.current = null; },
        onPointerCancel: () => { drag.current = null; },
    } : {};

    return (
        <Box
            {...handlers}
            sx={{
                position: 'relative', height, borderRadius: 2, overflow: 'hidden', border: 1, borderColor: 'divider',
                bgcolor: '#dfe6ea', touchAction: onPan ? 'none' : 'auto', cursor: onPan ? 'grab' : 'inherit',
                userSelect: 'none', '&:active': onPan ? { cursor: 'grabbing' } : {},
            }}
        >
            <Box sx={{ position: 'absolute', left: '50%', top: '50%' }}>
                {tiles.map(tile => (
                    <img
                        key={tile.key}
                        src={tile.src}
                        alt=""
                        loading="lazy"
                        draggable={false}
                        style={{ position: 'absolute', left: tile.left, top: tile.top, width: TILE, height: TILE, maxWidth: 'none' }}
                    />
                ))}
            </Box>
            {showPin && <PlaceRounded
                aria-hidden="true"
                sx={{
                    position: 'absolute', left: '50%', top: '50%', transform: 'translate(-50%, -92%)', pointerEvents: 'none',
                    fontSize: 40, color: 'primary.main', filter: 'drop-shadow(0 2px 3px rgba(0,0,0,0.45))',
                }}
            />}
            {children}
            <Box
                // Plain text when the whole map is already a link.
                {...(attributionLink
                    ? { component: 'a', href: 'https://www.openstreetmap.org/copyright', target: '_blank', rel: 'noopener noreferrer' }
                    : { component: 'span' })}
                onPointerDown={event => event.stopPropagation()}
                sx={{
                    position: 'absolute', right: 0, bottom: 0, px: 0.6, py: 0.1, fontSize: '0.6rem',
                    color: '#333', bgcolor: 'rgba(255,255,255,0.75)', textDecoration: 'none',
                }}
            >
                © OpenStreetMap
            </Box>
        </Box>
    );
}

TileMap.propTypes = {
    lat: PropTypes.number.isRequired,
    long: PropTypes.number.isRequired,
    zoom: PropTypes.number.isRequired,
    height: PropTypes.number,
    maxWidth: PropTypes.number,
    showPin: PropTypes.bool,
    attributionLink: PropTypes.bool,
    onPan: PropTypes.func,
    children: PropTypes.node,
};

export default TileMap;
