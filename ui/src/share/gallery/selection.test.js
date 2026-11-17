import { describe, expect, it } from 'vitest';
import { notIncludedText, ratedKeys, selectedPhotos, toggleSelection } from './selection';

const keys = ['a', 'b', 'c', 'd', 'e'];
const keyOf = tile => tile.infoHash;

describe('toggleSelection', () => {
    it('turns one photo on and off', () => {
        const on = toggleSelection(new Set(), keys, 'b');
        expect([...on]).toEqual(['b']);
        expect([...toggleSelection(on, keys, 'b')]).toEqual([]);
    });

    it('with Shift, gives every photo from the last tap to this one the same state, in either direction', () => {
        expect([...toggleSelection(new Set(['b']), keys, 'd', { range: true, anchor: 'b' })].sort()).toEqual(['b', 'c', 'd']);
        expect([...toggleSelection(new Set(['d']), keys, 'a', { range: true, anchor: 'd' })].sort()).toEqual(['a', 'b', 'c', 'd']);
        // Shift on a selected photo clears the range.
        expect([...toggleSelection(new Set(keys), keys, 'c', { range: true, anchor: 'a' })].sort()).toEqual(['d', 'e']);
    });

    it('takes one photo when the last tap is not in the list any more', () => {
        expect([...toggleSelection(new Set(), keys, 'c', { range: true, anchor: 'gone' })]).toEqual(['c']);
        expect([...toggleSelection(new Set(), keys, 'c', { range: true, anchor: null })]).toEqual(['c']);
    });

    it('does not change the set it is given', () => {
        const before = new Set(['a']);
        toggleSelection(before, keys, 'b');
        expect([...before]).toEqual(['a']);
    });
});

describe('selectedPhotos', () => {
    it('saves only the photos that are here in full, and counts the ones still arriving', () => {
        const here = { infoHash: 'a', elem: new Blob(['x']) };
        const arriving = { infoHash: 'b', loading: true, torrentFile: { done: false, blob: () => {} } };
        const other = { infoHash: 'c', elem: new Blob(['x']) };
        const result = selectedPhotos([here, arriving, other], new Set(['a', 'b']), keyOf);
        expect(result.chosen).toEqual([here, arriving]);
        expect(result.ready).toEqual([here]);
        expect(result.arriving).toBe(1);
    });
});

describe('ratedKeys', () => {
    it('lists the photos with one star or more, not the rejected ones', () => {
        const [a, b, c] = [{ infoHash: 'a' }, { infoHash: 'b' }, { infoHash: 'c' }];
        const facts = new Map([[a, { rating: 3 }], [b, { rating: -1 }], [c, { rating: 0 }]]);
        expect(ratedKeys([a, b, c], facts, keyOf)).toEqual(['a']);
    });
});

describe('notIncludedText', () => {
    it('says how many photos are not included', () => {
        expect(notIncludedText(0)).toBe('');
        expect(notIncludedText(1)).toBe('1 photo is still arriving. It is not included.');
        expect(notIncludedText(2)).toBe('2 photos are still arriving. They are not included.');
    });
});
