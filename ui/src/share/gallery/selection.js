import { isReadyToSave } from './saveRoom';

// Selecting several photos in Photographer mode's list, to save them in one go.

/**
 * The selection after a tap on one photo's box. The tap turns that photo
 * on or off. With `range` (Shift held), every photo from `anchor`, the photo
 * tapped before, to this one gets the same state. `keys` is the list's order.
 */
export function toggleSelection(selected, keys, key, { range = false, anchor = null } = {}) {
    const next = new Set(selected);
    const on = !selected.has(key);
    const from = range && anchor != null ? keys.indexOf(anchor) : -1;
    const to = keys.indexOf(key);
    const span = from >= 0 && to >= 0
        ? keys.slice(Math.min(from, to), Math.max(from, to) + 1)
        : [key];
    span.forEach(each => (on ? next.add(each) : next.delete(each)));
    return next;
}

/**
 * The selected photos of the ones shown: all of them, those here in full
 * (which a save takes) and how many are still arriving (which it does not).
 */
export function selectedPhotos(tiles, selected, keyOf) {
    const chosen = tiles.filter(tile => selected.has(keyOf(tile)));
    const ready = chosen.filter(isReadyToSave);
    return { chosen, ready, arriving: chosen.length - ready.length };
}

/** The keys of the photos with one star or more, of the ones shown. */
export function ratedKeys(tiles, facts, keyOf) {
    return tiles.filter(tile => (facts.get(tile)?.rating || 0) > 0).map(keyOf);
}

/** "1 photo is still arriving. It is not included." */
export function notIncludedText(arriving) {
    if (!arriving) return '';
    return arriving === 1
        ? '1 photo is still arriving. It is not included.'
        : `${arriving} photos are still arriving. They are not included.`;
}
