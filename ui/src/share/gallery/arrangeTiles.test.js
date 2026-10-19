import { describe, it, expect } from 'vitest';
import { arrangeTiles, DEFAULT_VIEW, NO_PLACE, placeGroup } from './arrangeTiles';

const tile = (fileName, details = {}, takenAt = null, extra = {}) => ({
    fileName, isImage: true, details, picDateTakenDate: takenAt ? new Date(takenAt) : undefined, ...extra,
});

const zurich = { lat: 47.37, long: 8.54, name: 'Lindenhof, Zurich, Switzerland' };
const shanghai = { lat: 31.24, long: 121.49, name: 'The Bund, Huangpu, Shanghai, China' };

const TILES = [
    tile('a.jpg', { rating: 4, title: 'Lake', location: zurich, keywords: ['swan'] }, '2024-05-01'),
    tile('b.jpg', { rating: 2, title: 'Bund at night', location: shanghai }, '2023-01-01'),
    tile('c.jpg', { rating: 5, description: 'Old town walk', location: { ...zurich, name: 'Altstadt, Zurich, Switzerland' } }, null),
    tile('d.jpg', {}, '2025-03-03'),
];

const names = result => result.tiles.map(item => item.fileName);
const view = changes => ({ ...DEFAULT_VIEW, ...changes });

describe('arrangeTiles', () => {
    it('keeps room order by default and offers the places found', () => {
        const result = arrangeTiles(TILES, DEFAULT_VIEW, null);
        expect(names(result)).toEqual(['a.jpg', 'b.jpg', 'c.jpg', 'd.jpg']);
        expect(result.places).toEqual([{ name: 'Zurich, Switzerland', count: 2 }, { name: 'Shanghai, China', count: 1 }]);
        expect(result.unplaced).toBe(1);
    });

    it('shows 4★ and up, best first', () => {
        expect(names(arrangeTiles(TILES, view({ minRating: 4, sort: 'rating' }), null))).toEqual(['c.jpg', 'a.jpg']);
    });

    it('filters by place, including photos without one', () => {
        expect(names(arrangeTiles(TILES, view({ place: 'Zurich, Switzerland' }), null))).toEqual(['a.jpg', 'c.jpg']);
        expect(names(arrangeTiles(TILES, view({ place: NO_PLACE }), null))).toEqual(['d.jpg']);
    });

    it('sorts by date taken either way, undated photos last', () => {
        expect(names(arrangeTiles(TILES, view({ sort: 'taken-desc' }), null))).toEqual(['d.jpg', 'a.jpg', 'b.jpg', 'c.jpg']);
        expect(names(arrangeTiles(TILES, view({ sort: 'taken-asc' }), null))).toEqual(['b.jpg', 'a.jpg', 'd.jpg', 'c.jpg']);
    });

    it('sorts by title with untitled photos last', () => {
        expect(names(arrangeTiles(TILES, view({ sort: 'title' }), null))).toEqual(['b.jpg', 'a.jpg', 'c.jpg', 'd.jpg']);
    });

    it('searches titles, descriptions, keywords, places and file names', () => {
        expect(names(arrangeTiles(TILES, view({ query: 'zurich' }), null))).toEqual(['a.jpg', 'c.jpg']);
        expect(names(arrangeTiles(TILES, view({ query: 'SWAN' }), null))).toEqual(['a.jpg']);
        expect(names(arrangeTiles(TILES, view({ query: 'old walk' }), null))).toEqual(['c.jpg']);
        expect(names(arrangeTiles(TILES, view({ query: 'd.jpg' }), null))).toEqual(['d.jpg']);
    });

    it('keeps uploads still arriving first and unfiltered', () => {
        const uploading = tile('new.jpg', {}, null, { loading: true });
        expect(names(arrangeTiles([...TILES, uploading], view({ minRating: 5 }), null))).toEqual(['new.jpg', 'c.jpg']);
    });

    it('groups places by town and country', () => {
        expect(placeGroup('The Bund, Huangpu, Shanghai, China')).toBe('Shanghai, China');
        expect(placeGroup('Valais, Switzerland')).toBe('Valais, Switzerland');
        expect(placeGroup(null)).toBeNull();
    });
});
