import { describe, it, expect, vi, beforeEach } from 'vitest';
import { isDark, onColorsChange, readColors, saveColors } from './colors';


function memoryStorage() {
    const items = new Map();
    return {
        getItem: key => (items.has(key) ? items.get(key) : null),
        setItem: (key, value) => items.set(key, String(value)),
        removeItem: key => items.delete(key),
        clear: () => items.clear(),
    };
}

describe('colors', () => {
    beforeEach(() => vi.stubGlobal('localStorage', memoryStorage()));

    it('follows the device until the person picks', () => {
        expect(readColors()).toBe('device');
        expect(isDark('device', true)).toBe(true);
        expect(isDark('device', false)).toBe(false);
        expect(isDark('light', true)).toBe(false);
        expect(isDark('dark', false)).toBe(true);
    });

    it('keeps the pick and tells the page', () => {
        const seen = vi.fn();
        const stop = onColorsChange(seen);
        saveColors('light');
        expect(readColors()).toBe('light');
        expect(seen).toHaveBeenCalledWith('light');
        stop();
        saveColors('dark');
        expect(seen).toHaveBeenCalledTimes(1);
    });

    it('ignores an unknown stored value', () => {
        localStorage.setItem('photogroup.colors', 'purple');
        expect(readColors()).toBe('device');
    });
});
