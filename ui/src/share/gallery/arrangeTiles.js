import { groupMetadataForDisplay } from './metadata/groupPhotoMetadata';
import { isValidLocation, knownPlaceName } from './metadata/geo';

// Sorting and filtering the gallery: what a photo's rating, date taken and
// place are, and which photos a view shows in what order.

export const DEFAULT_VIEW = { sort: 'added', minRating: 0, place: '', query: '' };

export const SORTS = [
    { id: 'added', label: 'Recently added' },
    { id: 'taken-desc', label: 'Taken, newest first' },
    { id: 'taken-asc', label: 'Taken, oldest first' },
    { id: 'rating', label: 'Highest rated' },
    { id: 'title', label: 'Title A–Z' },
];

/** Filter value for photos without a location. */
export const NO_PLACE = '__none__';

/** "Zurich, Switzerland" from "Lindenhof, Zurich, Switzerland": the town and country, for grouping. */
export function placeGroup(name) {
    if (!name) return null;
    const parts = String(name).split(',').map(part => part.trim()).filter(Boolean);
    return parts.slice(-2).join(', ') || null;
}

function toTime(value) {
    if (!value) return null;
    const time = value instanceof Date ? value.getTime() : new Date(value).getTime();
    return Number.isFinite(time) ? time : null;
}

/** What sorting and filtering need to know about one tile. */
export function tileFacts(tile, master) {
    const summary = tile.metadata && master && master.metadata
        ? master.metadata.createMetadataSummary(tile.metadata, tile) : null;
    const grouped = groupMetadataForDisplay(summary, tile);
    const location = grouped.location && isValidLocation(Number(grouped.location.lat), Number(grouped.location.long))
        ? grouped.location : null;
    const place = location ? (location.name || knownPlaceName(Number(location.lat), Number(location.long)) || null) : null;
    return {
        rating: grouped.values.rating || 0,
        takenAt: toTime(tile.picDateTakenDate),
        location,
        place,
        placeGroup: placeGroup(place),
        title: grouped.values.title || '',
        description: grouped.values.description || '',
        keywords: grouped.values.keywords || [],
        fileName: tile.fileName || '',
    };
}

function matches(facts, view) {
    if (view.minRating > 0 && facts.rating < view.minRating) return false;
    if (view.place === NO_PLACE && facts.location) return false;
    if (view.place && view.place !== NO_PLACE && facts.placeGroup !== view.place) return false;
    const query = String(view.query || '').trim().toLowerCase();
    if (query) {
        const haystack = [facts.title, facts.description, facts.place, facts.fileName, ...facts.keywords]
            .filter(Boolean).join('\n').toLowerCase();
        return query.split(/\s+/).every(word => haystack.includes(word));
    }
    return true;
}

const byTaken = direction => (a, b) => {
    if (a.facts.takenAt == null && b.facts.takenAt == null) return a.order - b.order;
    if (a.facts.takenAt == null) return 1;
    if (b.facts.takenAt == null) return -1;
    return direction * (a.facts.takenAt - b.facts.takenAt) || a.order - b.order;
};

const COMPARE = {
    added: (a, b) => a.order - b.order,
    'taken-desc': byTaken(-1),
    'taken-asc': byTaken(1),
    rating: (a, b) => b.facts.rating - a.facts.rating || byTaken(-1)(a, b),
    title: (a, b) => {
        if (!a.facts.title !== !b.facts.title) return a.facts.title ? -1 : 1;
        return a.facts.title.localeCompare(b.facts.title) || a.order - b.order;
    },
};

/** Whether a view narrows the gallery down (as opposed to only ordering it). */
export function isFiltered(view) {
    return view.minRating > 0 || !!view.place || !!String(view.query || '').trim();
}

/**
 * The tiles a view shows, in order, plus the places to offer as filters.
 * Uploads still arriving stay first and unfiltered, since nothing is known
 * about them yet.
 */
export function arrangeTiles(tiles, view, master) {
    const loading = [];
    const known = [];
    tiles.forEach((tile, order) => {
        if (tile.loading) loading.push(tile);
        else known.push({ tile, order, facts: tileFacts(tile, master) });
    });

    const groups = new Map();
    let unplaced = 0;
    known.forEach(({ facts }) => {
        if (facts.placeGroup) groups.set(facts.placeGroup, (groups.get(facts.placeGroup) || 0) + 1);
        else if (!facts.location) unplaced += 1;
    });
    const places = [...groups.entries()]
        .sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0]))
        .map(([name, count]) => ({ name, count }));

    const shown = known.filter(item => matches(item.facts, view))
        .sort(COMPARE[view.sort] || COMPARE.added);
    return {
        tiles: [...loading, ...shown.map(item => item.tile)],
        facts: new Map(shown.map(item => [item.tile, item.facts])),
        places,
        unplaced,
        total: tiles.length,
    };
}
