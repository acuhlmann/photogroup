import { useSyncExternalStore } from 'react';
import Logger from 'js-logger';

// Which photos the person using this browser already has as originals, so
// saving a room only adds what is new to them. Kept by fingerprint, so it
// holds across rooms and reloads: photos shared from here, saved from here,
// or found on this device.

const KEY = 'photogroup.alreadyHave';
const LIMIT = 5000;

let entries = null;
let version = 0;
const listeners = new Set();

function load() {
    if (entries) return entries;
    entries = new Map();
    try {
        const stored = JSON.parse(localStorage.getItem(KEY) || '[]');
        if (Array.isArray(stored)) {
            stored.forEach(item => {
                if (Array.isArray(item) && typeof item[0] === 'string') entries.set(item[0], item[1]);
            });
        }
    } catch {
        // Unreadable or blocked storage; start empty.
    }
    return entries;
}

function persist() {
    try {
        localStorage.setItem(KEY, JSON.stringify(Array.from(entries).slice(-LIMIT)));
    } catch (err) {
        Logger.warn('Could not remember which photos you have: ' + (err && err.message ? err.message : err));
    }
}

/**
 * Note that these fingerprints are files the person has: `how` is
 * 'shared' (uploaded from here), 'saved' (saved from a room) or 'device'
 * (found in a folder on this device). The latest reason wins.
 */
export function rememberHave(fingerprints, how) {
    const list = (Array.isArray(fingerprints) ? fingerprints : [fingerprints]).filter(Boolean);
    if (!list.length) return;
    const map = load();
    list.forEach(fingerprint => {
        map.delete(fingerprint);
        map.set(fingerprint, how);
    });
    while (map.size > LIMIT) map.delete(map.keys().next().value);
    persist();
    version += 1;
    listeners.forEach(listener => listener());
}

/** How the person already has this tile's file, 'shared', 'saved' or 'device', or null when they don't. */
export function alreadyHave(tile) {
    if (!tile) return null;
    if (tile.seed) return 'shared';
    return (tile.fingerprint && load().get(tile.fingerprint)) || null;
}

/** Be told whenever the set changes; returns the unsubscribe function. */
export function onHaveChange(listener) {
    listeners.add(listener);
    return () => listeners.delete(listener);
}

/** Re-render when the set changes. */
export function useHaveChanges() {
    return useSyncExternalStore(onHaveChange, () => version);
}

export const HAVE_LABELS = {
    shared: 'You shared this',
    saved: 'You saved this',
    device: 'On this device',
};

/** Forget everything, in memory and stored. */
export function clearHave() {
    entries = new Map();
    try {
        localStorage.removeItem(KEY);
    } catch {
        // Nothing stored to clear.
    }
    version += 1;
    listeners.forEach(listener => listener());
}
