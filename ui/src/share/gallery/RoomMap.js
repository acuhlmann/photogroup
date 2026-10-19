import React, { useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react';
import PropTypes from 'prop-types';
import Box from '@mui/material/Box';
import Stack from '@mui/material/Stack';
import Typography from '@mui/material/Typography';
import IconButton from '@mui/material/IconButton';
import Tooltip from '@mui/material/Tooltip';
import AddRounded from '@mui/icons-material/AddRounded';
import RemoveRounded from '@mui/icons-material/RemoveRounded';
import FitScreenRounded from '@mui/icons-material/FitScreenRounded';
import PhotoRounded from '@mui/icons-material/PhotoRounded';
import MovieRounded from '@mui/icons-material/MovieRounded';
import MusicNoteRounded from '@mui/icons-material/MusicNoteRounded';
import RouteRounded from '@mui/icons-material/RouteRounded';
import TileMap from './metadata/TileMap';
import { fromTilePosition, tilePosition } from './metadata/geo';

const TILE = 256;
const HEIGHT = 480;
const MAX_WIDTH = 1600;
const MIN_ZOOM = 2;
const MAX_ZOOM = 18;
const PIN = 44;
const PADDING = 56;
// One per day of the trip, strong enough to read on OpenStreetMap tiles; repeats after eight days.
const DAY_COLOURS = ['#e53935', '#1e88e5', '#43a047', '#fb8c00', '#8e24aa', '#00897b', '#d81b60', '#6d4c41'];

/** The zoom and centre that fit every point in a box of width × height pixels. */
export function fitView(points, width, height) {
    if (!points.length) return { lat: 20, long: 0, zoom: MIN_ZOOM };
    for (let zoom = 16; zoom >= MIN_ZOOM; zoom--) {
        const spots = points.map(point => tilePosition(point.lat, point.long, zoom));
        const xs = spots.map(spot => spot.x);
        const ys = spots.map(spot => spot.y);
        const spanX = (Math.max(...xs) - Math.min(...xs)) * TILE;
        const spanY = (Math.max(...ys) - Math.min(...ys)) * TILE;
        if (spanX <= width - 2 * PADDING && spanY <= height - 2 * PADDING) {
            const centre = fromTilePosition((Math.max(...xs) + Math.min(...xs)) / 2, (Math.max(...ys) + Math.min(...ys)) / 2, zoom);
            return { ...centre, zoom: points.length === 1 ? Math.min(zoom, 14) : zoom };
        }
    }
    const centre = points.reduce((sum, point) => ({ lat: sum.lat + point.lat / points.length, long: sum.long + point.long / points.length }), { lat: 0, long: 0 });
    return { ...centre, zoom: MIN_ZOOM };
}

/** Where a location sits on the map, in pixels from its centre. */
function offset(location, view) {
    const centre = tilePosition(view.lat, view.long, view.zoom);
    const spot = tilePosition(location.lat, location.long, view.zoom);
    return { x: (spot.x - centre.x) * TILE, y: (spot.y - centre.y) * TILE };
}

/** Pins close enough to overlap at this zoom, grouped; each group sits where its first pin is. */
export function clusterPins(items, view) {
    const clusters = [];
    items.forEach(item => {
        const { x, y } = offset(item.location, view);
        const near = clusters.find(cluster => Math.hypot(cluster.x - x, cluster.y - y) < PIN);
        if (near) near.items.push(item);
        else clusters.push({ x, y, items: [item] });
    });
    return clusters;
}

/** The local calendar day of a time, as "2026-10-19". */
function dayOf(time) {
    const date = new Date(time);
    return [date.getFullYear(), date.getMonth() + 1, date.getDate()].map(part => String(part).padStart(2, '0')).join('-');
}

/**
 * The trip as one line per day, joining the dated photos in the order they
 * were taken. Each day's line starts where the day before ended, so the
 * route stays unbroken. Empty with fewer than two dated photos.
 */
export function tripRoute(items) {
    const dated = items.filter(item => item.takenAt != null).sort((a, b) => a.takenAt - b.takenAt);
    if (dated.length < 2) return [];
    const days = [];
    dated.forEach(item => {
        const day = dayOf(item.takenAt);
        let current = days[days.length - 1];
        if (!current || current.day !== day) {
            const [year, month, date] = day.split('-').map(Number);
            current = {
                day, date: new Date(year, month - 1, date), colour: DAY_COLOURS[days.length % DAY_COLOURS.length],
                points: current ? [current.points[current.points.length - 1]] : [],
            };
            days.push(current);
        }
        current.points.push(item.location);
    });
    return days;
}

function Thumb({ item }) {
    const tile = item.tile;
    if (tile.isImage && tile.img) {
        return <img src={tile.img} alt="" draggable={false} style={{ width: '100%', height: '100%', objectFit: 'cover', display: 'block' }} />;
    }
    const Icon = tile.isVideo ? MovieRounded : tile.isAudio ? MusicNoteRounded : PhotoRounded;
    return <Icon sx={{ fontSize: 22, color: 'primary.main' }} />;
}

/**
 * Every photo in view that has a location, as pins on one map. Tapping a
 * pin opens that photo; tapping a group of pins zooms in on it. Photos with
 * a date taken are joined into the trip's route, a colour for each day.
 */
function RoomMap({ items, unplaced, onOpen }) {
    const boxRef = useRef(null);
    const [width, setWidth] = useState(800);
    const points = useMemo(() => items.map(item => item.location), [items]);
    const [view, setView] = useState(() => fitView(points, 800, HEIGHT));
    const fittedFor = useRef(null);
    const [showRoute, setShowRoute] = useState(true);
    const route = useMemo(() => tripRoute(items), [items]);

    useLayoutEffect(() => {
        const node = boxRef.current;
        if (!node) return undefined;
        const measure = () => setWidth(node.clientWidth || 800);
        measure();
        if (typeof ResizeObserver === 'undefined') return undefined;
        const observer = new ResizeObserver(measure);
        observer.observe(node);
        return () => observer.disconnect();
    }, []);

    // Fit again when the set of photos changes (a filter, a new location), not on every render.
    const signature = points.map(point => `${point.lat},${point.long}`).join('|');
    useEffect(() => {
        if (fittedFor.current === `${signature}@${width}`) return;
        fittedFor.current = `${signature}@${width}`;
        setView(fitView(points, width, HEIGHT));
    }, [signature, width, points]);

    const clusters = clusterPins(items, view);
    const zoomTo = (zoom, centre = view) => setView({ lat: centre.lat, long: centre.long, zoom: Math.max(MIN_ZOOM, Math.min(MAX_ZOOM, zoom)) });

    const openCluster = cluster => {
        const first = cluster.items[0];
        const samePlace = cluster.items.every(item => item.location.lat === first.location.lat && item.location.long === first.location.long);
        if (cluster.items.length === 1 || samePlace || view.zoom >= MAX_ZOOM - 1) {
            onOpen(first.tile);
        } else {
            const centre = tilePosition(view.lat, view.long, view.zoom);
            zoomTo(view.zoom + 2, fromTilePosition(centre.x + cluster.x / TILE, centre.y + cluster.y / TILE, view.zoom));
        }
    };

    return (
        <Box ref={boxRef} data-testid="room-map" sx={{ mb: 3 }}>
            {items.length === 0 ? (
                <Box sx={{ p: 4, textAlign: 'center', border: 1, borderColor: 'divider', borderRadius: 2 }}>
                    <Typography variant="body2" sx={{ color: 'text.secondary' }}>
                        None of these photos has a location yet. Open one and use “Add a location”.
                    </Typography>
                </Box>
            ) : (
                <TileMap lat={view.lat} long={view.long} zoom={view.zoom} height={HEIGHT} maxWidth={MAX_WIDTH} showPin={false}
                    onPan={(lat, long) => setView(current => ({ ...current, lat, long }))}>
                    {showRoute && route.length > 0 && (
                        <Box component="svg" data-testid="trip-route" aria-hidden="true" width={1} height={1}
                            sx={{ position: 'absolute', left: '50%', top: '50%', overflow: 'visible', pointerEvents: 'none' }}>
                            {route.map(day => {
                                const points = day.points.map(point => offset(point, view)).map(({ x, y }) => `${x},${y}`).join(' ');
                                return (
                                    <g key={day.day}>
                                        <polyline points={points} fill="none" stroke="#fff" strokeOpacity={0.85} strokeWidth={7}
                                            strokeLinecap="round" strokeLinejoin="round" />
                                        <polyline points={points} fill="none" stroke={day.colour} strokeWidth={4}
                                            strokeLinecap="round" strokeLinejoin="round" />
                                    </g>
                                );
                            })}
                        </Box>
                    )}
                    {clusters.map(cluster => {
                        const first = cluster.items[0];
                        const label = cluster.items.length === 1
                            ? `Open ${first.label}`
                            : `${cluster.items.length} photos here: ${cluster.items.map(item => item.label).join(', ')}`;
                        return (
                            <Tooltip key={first.tile.infoHash || first.label} title={label}>
                                <Box component="button" type="button" aria-label={label}
                                    onPointerDown={event => event.stopPropagation()}
                                    onClick={() => openCluster(cluster)}
                                    sx={{
                                        position: 'absolute', left: `calc(50% + ${cluster.x}px)`, top: `calc(50% + ${cluster.y}px)`,
                                        transform: 'translate(-50%, -100%)', width: PIN, height: PIN, p: 0, cursor: 'pointer',
                                        border: '3px solid', borderColor: 'background.paper', borderRadius: '50% 50% 50% 4px',
                                        rotate: '-45deg', overflow: 'visible', bgcolor: 'background.paper',
                                        boxShadow: '0 2px 6px rgba(0,0,0,0.45)', '&:hover, &:focus-visible': { borderColor: 'primary.main', zIndex: 2 },
                                    }}>
                                    <Box sx={{
                                        rotate: '45deg', width: '100%', height: '100%', borderRadius: '50%', overflow: 'hidden',
                                        display: 'flex', alignItems: 'center', justifyContent: 'center', bgcolor: 'var(--accent-soft)',
                                    }}>
                                        <Thumb item={first} />
                                    </Box>
                                    {cluster.items.length > 1 && (
                                        <Box component="span" sx={{
                                            position: 'absolute', top: -10, right: -10, rotate: '45deg', minWidth: 20, height: 20, px: 0.5,
                                            borderRadius: 10, bgcolor: 'primary.main', color: 'primary.contrastText', fontSize: 12,
                                            fontWeight: 700, lineHeight: '20px', textAlign: 'center',
                                        }}>
                                            {cluster.items.length}
                                        </Box>
                                    )}
                                </Box>
                            </Tooltip>
                        );
                    })}
                    <Stack spacing={0.5} sx={{ position: 'absolute', top: 8, right: 8 }} onPointerDown={event => event.stopPropagation()}>
                        {[['Zoom in', AddRounded, () => zoomTo(view.zoom + 1)],
                            ['Zoom out', RemoveRounded, () => zoomTo(view.zoom - 1)],
                            ['Show all photos', FitScreenRounded, () => setView(fitView(points, width, HEIGHT))],
                            ...(route.length ? [['Trip route', RouteRounded,
                                () => setShowRoute(shown => !shown), showRoute]] : [])]
                            .map(([label, Icon, action, pressed]) => (
                                <IconButton key={label} size="small" aria-label={label}
                                    aria-pressed={pressed} onClick={action} sx={{
                                        bgcolor: 'background.paper', border: 1, borderColor: 'divider', borderRadius: 1, p: 0.25,
                                        color: pressed ? 'primary.main' : undefined, '&:hover': { bgcolor: 'background.paper' },
                                    }}>
                                    <Icon fontSize="small" />
                                </IconButton>
                            ))}
                    </Stack>
                </TileMap>
            )}
            <Typography variant="caption" sx={{ display: 'block', mt: 0.75, color: 'text.secondary' }}>
                {items.length} {items.length === 1 ? 'photo' : 'photos'} on the map
                {unplaced > 0 ? ` · ${unplaced} without a location` : ''}
            </Typography>
            {showRoute && route.length > 0 && (
                <Stack direction="row" data-testid="trip-days" useFlexGap sx={{ flexWrap: 'wrap', columnGap: 1.5, rowGap: 0.25, mt: 0.5 }}>
                    {route.map((day, index) => (
                        <Typography key={day.day} variant="caption" sx={{ display: 'inline-flex', alignItems: 'center', gap: 0.5, color: 'text.secondary' }}>
                            <Box component="span" sx={{ width: 14, height: 4, borderRadius: 2, bgcolor: day.colour }} />
                            Day {index + 1} · {day.date.toLocaleDateString(undefined, { weekday: 'short', day: 'numeric', month: 'short' })}
                        </Typography>
                    ))}
                </Stack>
            )}
        </Box>
    );
}

RoomMap.propTypes = {
    items: PropTypes.arrayOf(PropTypes.shape({
        tile: PropTypes.object.isRequired,
        location: PropTypes.shape({ lat: PropTypes.number, long: PropTypes.number }).isRequired,
        label: PropTypes.string.isRequired,
        takenAt: PropTypes.number,
    })).isRequired,
    unplaced: PropTypes.number,
    onOpen: PropTypes.func.isRequired,
};

export default RoomMap;
