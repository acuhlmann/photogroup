import { describe, it, expect } from 'vitest';
import { stallTip, seenText, outcomeLines, NO_CODES_TIP, STALLED_TIP } from './LightReceive';

describe('camera receiving feedback', () => {
    it('says nothing while codes are arriving', () => {
        expect(stallTip({ codes: 0, msSinceFresh: Infinity, msSinceStart: 2000 })).toBeNull();
        expect(stallTip({ codes: 12, msSinceFresh: 800, msSinceStart: 30000 })).toBeNull();
    });

    it('tells the person what to change when no code has been read', () => {
        expect(stallTip({ codes: 0, msSinceFresh: Infinity, msSinceStart: 7000 })).toBe(NO_CODES_TIP);
        expect(NO_CODES_TIP).toMatch(/brightness/);
    });

    it('names the likely causes when codes stop midway', () => {
        // The 7%-then-stopped report: the screen must say what to do next,
        // and that what was read is not lost.
        const tip = stallTip({ codes: 20, msSinceFresh: 6000, msSinceStart: 40000 });
        expect(tip).toBe(STALLED_TIP);
        expect(tip).toMatch(/Slow and sure/);
        expect(tip).toMatch(/kept/);
    });

    it('shows codes read, blocks held and how stale the last code is', () => {
        expect(seenText({ codes: 25, have: 9, blocks: 50, msSinceFresh: 3200 }))
            .toBe('25 of about 50 codes read · 9 of 50 blocks · last code 3s ago');
        expect(seenText({ codes: 0, have: 0, blocks: 50, msSinceFresh: null })).toBe('');
    });

    it('says which photos came in small size', () => {
        expect(outcomeLines([{ name: 'a.jpg', how: 'small' }])).toEqual(['a.jpg is here in small size.']);
        expect(outcomeLines([{ name: 'a.jpg', how: 'smallSaved' }]))
            .toEqual(['a.jpg is not in this room. It is saved on this phone in small size.']);
        expect(outcomeLines([
            { name: 'a.jpg', how: 'small' }, { name: 'b.jpg', how: 'small' }, { name: 'c.jpg', how: 'delivered' },
        ])).toEqual(['1 photo is here.', '2 photos are here in small size.']);
    });
});
