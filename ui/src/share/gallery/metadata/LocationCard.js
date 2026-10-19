import React, { useEffect, useState } from 'react';
import PropTypes from 'prop-types';
import Box from '@mui/material/Box';
import Stack from '@mui/material/Stack';
import Typography from '@mui/material/Typography';
import Button from '@mui/material/Button';
import IconButton from '@mui/material/IconButton';
import Tooltip from '@mui/material/Tooltip';
import PlaceRounded from '@mui/icons-material/PlaceRounded';
import OpenInNewRounded from '@mui/icons-material/OpenInNewRounded';
import ContentCopyRounded from '@mui/icons-material/ContentCopyRounded';
import LocationOffRounded from '@mui/icons-material/LocationOffRounded';
import { format } from 'date-fns';
import {
    formatDecimal, formatDirection, formatDms, isValidLocation, mapLinks, reverseGeocode, tilePosition,
} from './geo';

const TILE = 256;
const MAP_ZOOM = 14;

const factSx = {
    fontFamily: 'var(--font-mono)',
    fontSize: '0.72rem',
    color: 'text.primary',
    px: 0.8,
    py: 0.25,
    borderRadius: '4px',
    bgcolor: 'var(--accent-soft)',
    fontVariantNumeric: 'tabular-nums',
};

/** The place name for a location, looked up once it is shown; null until known or when unknown. */
export function usePlaceName(location) {
    const [place, setPlace] = useState({ key: null, name: null, pending: false });
    const lat = location && Number(location.lat);
    const long = location && Number(location.long);
    const valid = !!location && isValidLocation(lat, long);
    const key = valid ? `${lat},${long}` : null;

    useEffect(() => {
        if (!key) return undefined;
        let cancelled = false;
        setPlace({ key, name: null, pending: true });
        reverseGeocode(lat, long).then(name => {
            if (!cancelled) setPlace({ key, name, pending: false });
        });
        return () => { cancelled = true; };
    }, [key, lat, long]);

    return place.key === key ? place : { key, name: null, pending: valid };
}

/** A small OpenStreetMap preview centred on the point, with a pin. */
function MapPreview({ lat, long, href }) {
    const { x, y } = tilePosition(lat, long, MAP_ZOOM);
    const scale = 2 ** MAP_ZOOM;
    const tiles = [];
    for (let dy = -1; dy <= 1; dy++) {
        for (let dx = -1; dx <= 1; dx++) {
            const tx = Math.floor(x) + dx;
            const ty = Math.floor(y) + dy;
            if (ty < 0 || ty >= scale) continue;
            tiles.push({
                key: `${dx},${dy}`,
                left: (tx - x) * TILE,
                top: (ty - y) * TILE,
                src: `https://tile.openstreetmap.org/${MAP_ZOOM}/${((tx % scale) + scale) % scale}/${ty}.png`,
            });
        }
    }

    return (
        <Box sx={{ position: 'relative', height: 168, borderRadius: 2, overflow: 'hidden', border: 1, borderColor: 'divider', bgcolor: '#dfe6ea' }}>
            <Box
                component="a"
                href={href}
                target="_blank"
                rel="noopener noreferrer"
                aria-label="Open the location in Google Maps"
                sx={{ position: 'absolute', inset: 0, display: 'block' }}
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
                <PlaceRounded
                    aria-hidden="true"
                    sx={{
                        position: 'absolute', left: '50%', top: '50%', transform: 'translate(-50%, -92%)',
                        fontSize: 40, color: 'primary.main', filter: 'drop-shadow(0 2px 3px rgba(0,0,0,0.45))',
                    }}
                />
            </Box>
            <Box
                component="a"
                href="https://www.openstreetmap.org/copyright"
                target="_blank"
                rel="noopener noreferrer"
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

function formatGpsTime(iso) {
    try {
        return format(new Date(iso), 'MMM d, yyyy · HH:mm');
    } catch {
        return null;
    }
}

/** Where a photo was taken: map, place name, coordinates, GPS extras and links to map apps. */
function LocationCard({ location }) {
    const lat = Number(location.lat);
    const long = Number(location.long);
    const place = usePlaceName(location);
    const [copied, setCopied] = useState(false);
    if (!isValidLocation(lat, long)) return null;

    const links = mapLinks(lat, long, place.name);
    const facts = [];
    if (Number.isFinite(location.altitude)) facts.push(['Altitude', `${Math.round(location.altitude)} m`]);
    if (Number.isFinite(location.direction)) facts.push(['Facing', formatDirection(location.direction)]);
    if (Number.isFinite(location.accuracy)) facts.push(['Accuracy', `±${Math.round(location.accuracy)} m`]);
    const time = location.time && formatGpsTime(location.time);
    if (time) facts.push(['GPS time', time]);

    const copy = () => {
        if (!navigator.clipboard) return;
        navigator.clipboard.writeText(`${lat.toFixed(6)}, ${long.toFixed(6)}`)
            .then(() => {
                setCopied(true);
                setTimeout(() => setCopied(false), 1500);
            })
            .catch(() => {});
    };

    return (
        <Box data-testid="location-card" sx={{ display: 'flex', flexDirection: 'column', gap: 1.25 }}>
            <MapPreview lat={lat} long={long} href={links[0].href} />
            <Box>
                <Typography variant="subtitle1" sx={{ fontWeight: 600, lineHeight: 1.3, wordBreak: 'break-word' }}>
                    {place.name || (place.pending ? 'Finding the place…' : formatDms(lat, long))}
                </Typography>
                <Stack direction="row" spacing={0.5} sx={{ alignItems: 'center' }}>
                    <Typography variant="body2" sx={{ color: 'text.secondary', fontFamily: 'var(--font-mono)', fontSize: '0.75rem' }}>
                        {place.name ? `${formatDms(lat, long)} · ` : ''}{formatDecimal(lat, long)}
                    </Typography>
                    <Tooltip title={copied ? 'Copied' : 'Copy coordinates'}>
                        <IconButton size="small" aria-label="Copy coordinates" onClick={copy} sx={{ p: 0.25 }}>
                            <ContentCopyRounded sx={{ fontSize: 14 }} />
                        </IconButton>
                    </Tooltip>
                </Stack>
            </Box>
            {facts.length > 0 && (
                <Stack direction="row" sx={{ flexWrap: 'wrap', gap: 0.75 }}>
                    {facts.map(([label, value]) => (
                        <Box key={label} component="span" sx={factSx}>
                            <Box component="span" sx={{ color: 'text.secondary' }}>{label} </Box>{value}
                        </Box>
                    ))}
                </Stack>
            )}
            <Stack direction="row" sx={{ flexWrap: 'wrap', gap: 0.75 }}>
                {links.map(link => (
                    <Button
                        key={link.id}
                        size="small"
                        variant="outlined"
                        href={link.href}
                        target="_blank"
                        rel="noopener noreferrer"
                        endIcon={<OpenInNewRounded sx={{ fontSize: '14px !important' }} />}
                        sx={{ textTransform: 'none' }}
                    >
                        {link.label}
                    </Button>
                ))}
            </Stack>
        </Box>
    );
}

LocationCard.propTypes = {
    location: PropTypes.shape({
        lat: PropTypes.number.isRequired,
        long: PropTypes.number.isRequired,
        altitude: PropTypes.number,
        direction: PropTypes.number,
        accuracy: PropTypes.number,
        time: PropTypes.string,
    }).isRequired,
};

/** One line for a gallery tile: the place (or coordinates) with links to Google Maps and Amap. */
export function LocationLine({ location }) {
    const lat = Number(location.lat);
    const long = Number(location.long);
    const place = usePlaceName(location);
    if (!isValidLocation(lat, long)) return null;
    const [google, amap] = mapLinks(lat, long, place.name);
    const linkSx = { color: 'primary.main', textDecoration: 'none', '&:hover': { textDecoration: 'underline' } };

    return (
        <Stack direction="row" spacing={0.5} data-testid="location-line" sx={{ alignItems: 'center', mt: 0.5, minWidth: 0 }}>
            <PlaceRounded aria-hidden="true" sx={{ fontSize: 16, color: 'primary.main', flexShrink: 0 }} />
            <Typography variant="caption" sx={{ minWidth: 0, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                <Box component="a" href={google.href} target="_blank" rel="noopener noreferrer" sx={linkSx}
                    title={formatDecimal(lat, long)}>
                    {place.name || formatDecimal(lat, long)}
                </Box>
                <Box component="span" sx={{ color: 'text.disabled' }}>{' · '}</Box>
                <Box component="a" href={amap.href} target="_blank" rel="noopener noreferrer" sx={linkSx}>高德</Box>
            </Typography>
        </Stack>
    );
}

LocationLine.propTypes = {
    location: PropTypes.object.isRequired,
};

export const LOCATION_BLANK_HELP = 'This photo has GPS fields, but they are blank. Android blanks them when '
    + 'a browser or app picks a photo without location access, and some apps remove location when sharing. '
    + 'To keep it, upload the original file from a computer.';

/** Says a photo's GPS fields were blanked before it reached the app, so "no location" isn't a mystery. */
export function LocationBlankNote() {
    return (
        <Stack direction="row" spacing={1.25} data-testid="location-blank" sx={{
            alignItems: 'flex-start', p: 1.5, borderRadius: 2, border: 1, borderColor: 'divider', bgcolor: 'action.hover',
        }}>
            <LocationOffRounded aria-hidden="true" sx={{ fontSize: 22, color: 'text.secondary', mt: '1px' }} />
            <Box>
                <Typography variant="subtitle2" sx={{ fontWeight: 600 }}>Location removed before upload</Typography>
                <Typography variant="body2" sx={{ color: 'text.secondary', lineHeight: 1.5 }}>
                    {LOCATION_BLANK_HELP}
                </Typography>
            </Box>
        </Stack>
    );
}

/** The tile's version: one quiet line, with the explanation on hover. */
export function LocationBlankLine() {
    return (
        <Tooltip title={LOCATION_BLANK_HELP}>
            <Stack direction="row" spacing={0.5} data-testid="location-blank-line" sx={{ alignItems: 'center', mt: 0.5, width: 'fit-content' }}>
                <LocationOffRounded aria-hidden="true" sx={{ fontSize: 16, color: 'text.disabled' }} />
                <Typography variant="caption" sx={{ color: 'text.secondary' }}>Location removed before upload</Typography>
            </Stack>
        </Tooltip>
    );
}

export default LocationCard;
