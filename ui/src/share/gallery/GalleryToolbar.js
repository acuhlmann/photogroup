import React from 'react';
import PropTypes from 'prop-types';
import Box from '@mui/material/Box';
import Stack from '@mui/material/Stack';
import Typography from '@mui/material/Typography';
import TextField from '@mui/material/TextField';
import MenuItem from '@mui/material/MenuItem';
import Button from '@mui/material/Button';
import ToggleButton from '@mui/material/ToggleButton';
import ToggleButtonGroup from '@mui/material/ToggleButtonGroup';
import InputAdornment from '@mui/material/InputAdornment';
import GridViewRounded from '@mui/icons-material/GridViewRounded';
import MapRounded from '@mui/icons-material/MapRounded';
import SearchRounded from '@mui/icons-material/SearchRounded';
import { DEFAULT_VIEW, NO_PLACE, SORTS, isFiltered } from './arrangeTiles';

const RATINGS = [
    { value: 0, label: 'Any rating' },
    ...[5, 4, 3, 2, 1].map(stars => ({ value: stars, label: stars === 5 ? '5★ only' : `${stars}★ and up` })),
];

const selectSx = { minWidth: 150, '& .MuiInputBase-input': { py: 0.75, fontSize: '0.85rem' } };

/** Grid or map, sort, and filters for the gallery. */
function GalleryToolbar({ view, onChange, mode, onModeChange, places, unplaced, shown, total }) {
    const set = changes => onChange({ ...view, ...changes });
    return (
        <Box component="section" aria-label="Sort and filter photos" sx={{ mb: 2 }}>
            <Stack direction="row" sx={{ flexWrap: 'wrap', gap: 1, alignItems: 'center' }}>
                <ToggleButtonGroup size="small" exclusive value={mode} onChange={(event, next) => next && onModeChange(next)}
                    aria-label="Show photos as">
                    <ToggleButton value="grid" aria-label="Grid" sx={{ px: 1.25, gap: 0.5, textTransform: 'none' }}>
                        <GridViewRounded fontSize="small" /> Grid
                    </ToggleButton>
                    <ToggleButton value="map" aria-label="Map" sx={{ px: 1.25, gap: 0.5, textTransform: 'none' }}>
                        <MapRounded fontSize="small" /> Map
                    </ToggleButton>
                </ToggleButtonGroup>
                <TextField select size="small" label="Sort" value={view.sort} onChange={event => set({ sort: event.target.value })}
                    sx={selectSx}>
                    {SORTS.map(sort => <MenuItem key={sort.id} value={sort.id}>{sort.label}</MenuItem>)}
                </TextField>
                <TextField select size="small" label="Rating" value={view.minRating}
                    onChange={event => set({ minRating: Number(event.target.value) })} sx={{ ...selectSx, minWidth: 130 }}>
                    {RATINGS.map(rating => <MenuItem key={rating.value} value={rating.value}>{rating.label}</MenuItem>)}
                </TextField>
                <TextField select size="small" label="Place" value={view.place} onChange={event => set({ place: event.target.value })}
                    slotProps={{ select: { displayEmpty: true }, inputLabel: { shrink: true } }} sx={selectSx}>
                    <MenuItem value="">Anywhere</MenuItem>
                    {places.map(place => (
                        <MenuItem key={place.name} value={place.name}>{place.name} ({place.count})</MenuItem>
                    ))}
                    {unplaced > 0 && <MenuItem value={NO_PLACE}>No location ({unplaced})</MenuItem>}
                </TextField>
                <TextField size="small" placeholder="Search titles, places, keywords…" value={view.query}
                    onChange={event => set({ query: event.target.value })}
                    slotProps={{
                        htmlInput: { 'aria-label': 'Search photos' },
                        input: { startAdornment: <InputAdornment position="start"><SearchRounded fontSize="small" /></InputAdornment> },
                    }}
                    sx={{ flex: '1 1 200px', minWidth: 180, '& .MuiInputBase-input': { py: 0.75, fontSize: '0.85rem' } }} />
            </Stack>
            {isFiltered(view) && (
                <Stack direction="row" spacing={1} sx={{ alignItems: 'center', mt: 1 }}>
                    <Typography variant="caption" sx={{ color: 'text.secondary' }} role="status">
                        Showing {shown} of {total}
                    </Typography>
                    <Button size="small" onClick={() => onChange({ ...DEFAULT_VIEW, sort: view.sort })} sx={{ textTransform: 'none' }}>
                        Clear filters
                    </Button>
                </Stack>
            )}
        </Box>
    );
}

GalleryToolbar.propTypes = {
    view: PropTypes.object.isRequired,
    onChange: PropTypes.func.isRequired,
    mode: PropTypes.oneOf(['grid', 'map']).isRequired,
    onModeChange: PropTypes.func.isRequired,
    places: PropTypes.array.isRequired,
    unplaced: PropTypes.number.isRequired,
    shown: PropTypes.number.isRequired,
    total: PropTypes.number.isRequired,
};

export default GalleryToolbar;
