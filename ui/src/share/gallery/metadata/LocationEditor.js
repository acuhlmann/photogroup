import React, { useState } from 'react';
import PropTypes from 'prop-types';
import Box from '@mui/material/Box';
import Stack from '@mui/material/Stack';
import Typography from '@mui/material/Typography';
import Button from '@mui/material/Button';
import IconButton from '@mui/material/IconButton';
import TextField from '@mui/material/TextField';
import AddRounded from '@mui/icons-material/AddRounded';
import RemoveRounded from '@mui/icons-material/RemoveRounded';
import SearchRounded from '@mui/icons-material/SearchRounded';
import MyLocationRounded from '@mui/icons-material/MyLocationRounded';
import TileMap from './TileMap';
import { formatDecimal, isValidLocation, searchPlaces } from './geo';

const WORLD = { lat: 20, long: 0, zoom: 2 };
const PLACE_ZOOM = 15;
const MIN_ZOOM = 2;
const MAX_ZOOM = 18;

const zoomButtonSx = {
    bgcolor: 'background.paper', border: 1, borderColor: 'divider', borderRadius: 1, p: 0.25,
    '&:hover': { bgcolor: 'background.paper' },
};

/**
 * Pick where a photo was taken: search for a place, use this device's
 * position, or drag the map under the pin. Saves {lat, long, name?} for
 * everyone in the room; "Remove" saves null, which hides the file's own.
 */
function LocationEditor({ initial, canRemove, onSave, onCancel }) {
    const start = initial && isValidLocation(initial.lat, initial.long);
    const [view, setView] = useState(start
        ? { lat: initial.lat, long: initial.long, zoom: PLACE_ZOOM }
        : WORLD);
    // The chosen place's name, kept only while the pin stays on it.
    const [named, setNamed] = useState(start && initial.name ? { name: initial.name, lat: initial.lat, long: initial.long } : null);
    const [picked, setPicked] = useState(!!start);
    const [query, setQuery] = useState('');
    const [results, setResults] = useState(null);
    const [busy, setBusy] = useState('');
    const [error, setError] = useState('');

    const moveTo = (lat, long, zoom = view.zoom, name = null) => {
        setView({ lat, long, zoom });
        setNamed(name ? { name, lat, long } : null);
        setPicked(true);
    };

    const search = async () => {
        if (!query.trim()) return;
        setBusy('search');
        setError('');
        try {
            const places = await searchPlaces(query);
            setResults(places);
            if (places.length === 1) moveTo(places[0].lat, places[0].long, PLACE_ZOOM, places[0].name);
        } catch (err) {
            setError((err && err.message) || 'Place search failed.');
        } finally {
            setBusy('');
        }
    };

    const useDevicePosition = () => {
        if (!navigator.geolocation) {
            setError('This browser cannot share its location.');
            return;
        }
        setBusy('device');
        setError('');
        navigator.geolocation.getCurrentPosition(
            position => {
                setBusy('');
                moveTo(position.coords.latitude, position.coords.longitude, 16);
            },
            err => {
                setBusy('');
                setError(err && err.code === 1 ? 'Location access was denied.' : 'Could not get this device\'s location.');
            },
            { enableHighAccuracy: true, timeout: 15000 });
    };

    const save = async (location) => {
        setBusy('save');
        setError('');
        try {
            await onSave(location);
        } catch (err) {
            setError(err && err.status === 404
                ? 'This photo is still being shared. Try again in a moment.'
                : (err && err.message) || 'Could not save. Try again.');
            setBusy('');
        }
    };

    const name = named && named.lat === view.lat && named.long === view.long ? named.name : null;
    const zoomBy = step => setView(current => ({ ...current, zoom: Math.max(MIN_ZOOM, Math.min(MAX_ZOOM, current.zoom + step)) }));

    return (
        <Box component="section" aria-label="Set location" data-testid="location-editor"
            sx={{ p: 1.5, borderRadius: 2, border: 1, borderColor: 'primary.main', display: 'flex', flexDirection: 'column', gap: 1.25 }}>
            <Box component="form" onSubmit={event => { event.preventDefault(); search(); }}
                sx={{ display: 'flex', gap: 0.75, alignItems: 'center' }}>
                <TextField
                    size="small"
                    fullWidth
                    placeholder="Search a place or address"
                    value={query}
                    onChange={event => setQuery(event.target.value)}
                    slotProps={{ htmlInput: { 'aria-label': 'Search a place' } }}
                />
                <IconButton type="submit" aria-label="Search" disabled={busy === 'search'}>
                    <SearchRounded />
                </IconButton>
            </Box>
            {results && (
                results.length ? (
                    <Box component="ul" aria-label="Places found" sx={{ m: 0, p: 0, listStyle: 'none', maxHeight: 180, overflow: 'auto' }}>
                        {results.map(place => (
                            <li key={`${place.lat},${place.long}`}>
                                <Box component="button" type="button"
                                    onClick={() => moveTo(place.lat, place.long, PLACE_ZOOM, place.name)}
                                    sx={{
                                        width: '100%', textAlign: 'left', p: 0.75, border: 0, borderRadius: 1, cursor: 'pointer',
                                        font: 'inherit', color: 'inherit', bgcolor: name === place.name ? 'action.selected' : 'transparent',
                                        '&:hover': { bgcolor: 'action.hover' },
                                    }}>
                                    <Typography variant="body2" sx={{ fontWeight: 600 }}>{place.name}</Typography>
                                    <Typography variant="caption" sx={{ color: 'text.secondary', display: 'block' }}>{place.label}</Typography>
                                </Box>
                            </li>
                        ))}
                    </Box>
                ) : (
                    <Typography variant="body2" sx={{ color: 'text.secondary' }}>No places found.</Typography>
                )
            )}
            <TileMap lat={view.lat} long={view.long} zoom={view.zoom} height={220}
                onPan={(lat, long) => moveTo(lat, long)}>
                <Stack spacing={0.5} sx={{ position: 'absolute', top: 8, right: 8 }} onPointerDown={event => event.stopPropagation()}>
                    <IconButton size="small" aria-label="Zoom in" onClick={() => zoomBy(1)} sx={zoomButtonSx}><AddRounded fontSize="small" /></IconButton>
                    <IconButton size="small" aria-label="Zoom out" onClick={() => zoomBy(-1)} sx={zoomButtonSx}><RemoveRounded fontSize="small" /></IconButton>
                </Stack>
            </TileMap>
            <Stack direction="row" spacing={1} sx={{ alignItems: 'center', flexWrap: 'wrap', rowGap: 0.5 }}>
                <Typography variant="body2" sx={{ fontFamily: 'var(--font-mono)', fontSize: '0.75rem', color: 'text.secondary', flex: 1 }}>
                    {picked ? (name ? `${name} · ` : '') + formatDecimal(view.lat, view.long) : 'Search, use your location, or drag the map under the pin.'}
                </Typography>
                <Button size="small" startIcon={<MyLocationRounded fontSize="small" />} onClick={useDevicePosition}
                    disabled={busy === 'device'} sx={{ textTransform: 'none' }}>
                    {busy === 'device' ? 'Locating…' : 'Use my location'}
                </Button>
            </Stack>
            {error && <Typography variant="body2" role="alert" sx={{ color: 'error.main' }}>{error}</Typography>}
            <Stack direction="row" spacing={1} sx={{ alignItems: 'center' }}>
                <Button variant="contained" size="small" disabled={!picked || busy === 'save'}
                    onClick={() => save(name ? { lat: view.lat, long: view.long, name } : { lat: view.lat, long: view.long })}>
                    {busy === 'save' ? 'Saving…' : 'Save for everyone'}
                </Button>
                <Button size="small" onClick={onCancel} disabled={busy === 'save'}>Cancel</Button>
                {canRemove && (
                    <Button size="small" color="error" onClick={() => save(null)} disabled={busy === 'save'} sx={{ ml: 'auto !important' }}>
                        Remove location
                    </Button>
                )}
            </Stack>
        </Box>
    );
}

LocationEditor.propTypes = {
    initial: PropTypes.object,
    canRemove: PropTypes.bool,
    onSave: PropTypes.func.isRequired,
    onCancel: PropTypes.func.isRequired,
};

export default LocationEditor;
