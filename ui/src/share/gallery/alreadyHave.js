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

/** The set as stored now; throws when storage can't be read. */
function readStored() {
    const map = new Map();
    const stored = JSON.parse(localStorage.getItem(KEY) || '[]');
    if (Array.isArray(stored)) {
        stored.forEach(item => {
            if (Array.isArray(item) && typeof item[0] === 'string') map.set(item[0], item[1]);
        });
    }
    return map;
}

function load() {
    if (entries) return entries;
    try {
        entries = readStored();
    } catch {
        // Unreadable or blocked storage; start empty.
        entries = new Map();
    }
    return entries;
}

function notify() {
    version += 1;
    listeners.forEach(listener => listener());
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
    // Start from what is stored now, so photos another tab added since this
    // one loaded aren't written over; keep anything only this tab knows.
    let map = load();
    try {
        const stored = readStored();
        map.forEach((value, key) => {
            if (!stored.has(key)) stored.set(key, value);
        });
        map = stored;
    } catch {
        // Storage is unreadable; carry on with this tab's set.
    }
    list.forEach(fingerprint => {
        map.delete(fingerprint);
        map.set(fingerprint, how);
    });
    while (map.size > LIMIT) map.delete(map.keys().next().value);
    entries = map;
    persist();
    notify();
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
    notify();
}

// Another tab changed the set: read it again, and update this tab's labels.
if (typeof window !== 'undefined' && typeof window.addEventListener === 'function') {
    window.addEventListener('storage', event => {
        if (event.key !== KEY && event.key !== null) return;
        entries = null;
        notify();
    });
}
