import Logger from 'js-logger';
import { fingerprintFile, fingerprintSize } from './fingerprint';
import { rememberHave } from './alreadyHave';

// Let people point at a folder of their own photos (a camera roll, a synced
// Google Photos folder) so the room can tell which of its photos they
// already have. Only files whose exact size matches a room photo are read,
// so a big folder is checked quickly.

const MAX_DEPTH = 8;

/** Files (or file handles) in a picked folder and its subfolders, skipping hidden ones like .thumbnails. */
async function collect(directory, found, depth) {
    for await (const entry of directory.values()) {
        if (entry.name.startsWith('.')) continue;
        if (entry.kind === 'file') {
            found.push(entry);
        } else if (entry.kind === 'directory' && depth < MAX_DEPTH) {
            await collect(entry, found, depth + 1);
        }
    }
    return found;
}

/** Pick with a hidden file input, a folder where the browser allows it; resolves to [] when closed. */
function pickWithInput(doc) {
    return new Promise(resolve => {
        const input = doc.createElement('input');
        input.type = 'file';
        input.multiple = true;
        input.webkitdirectory = true;
        input.style.display = 'none';
        const finish = files => {
            input.remove();
            resolve(files);
        };
        input.addEventListener('change', () => finish(Array.from(input.files || [])));
        input.addEventListener('cancel', () => finish([]));
        doc.body.appendChild(input);
        input.click();
    });
}

/**
 * Ask for a folder and return what is in it: file handles from the folder
 * picker, or Files from a file input where there is none. Empty when the
 * person backs out. Call it from a click, as browsers require.
 */
export async function pickFolder(win = window) {
    if (typeof win.showDirectoryPicker === 'function') {
        let directory;
        try {
            directory = await win.showDirectoryPicker({ id: 'photogroup-have', mode: 'read', startIn: 'pictures' });
        } catch (err) {
            if (err && err.name === 'AbortError') return [];
            throw err;
        }
        return collect(directory, [], 0);
    }
    return pickWithInput(win.document);
}

/**
 * Which room photos are among `entries` (Files or file handles), by
 * fingerprint. Remembers them as on this device and resolves to the
 * matching tiles. `onProgress(checked, total)` follows along.
 */
export async function findOnDevice(tiles, entries, { onProgress = () => {} } = {}) {
    const bySize = new Map();
    tiles.forEach(tile => {
        const size = fingerprintSize(tile.fingerprint);
        if (!Number.isFinite(size)) return;
        if (!bySize.has(size)) bySize.set(size, new Set());
        bySize.get(size).add(tile.fingerprint);
    });

    const found = new Set();
    for (let index = 0; index < entries.length; index++) {
        try {
            const entry = entries[index];
            const file = typeof entry.getFile === 'function' ? await entry.getFile() : entry;
            const candidates = bySize.get(file.size);
            if (candidates) {
                const fingerprint = await fingerprintFile(file);
                if (candidates.has(fingerprint)) found.add(fingerprint);
            }
        } catch (err) {
            Logger.warn('Skipped a file while looking for your photos: ' + (err && err.message ? err.message : err));
        }
        onProgress(index + 1, entries.length);
    }

    rememberHave([...found], 'device');
    return tiles.filter(tile => found.has(tile.fingerprint));
}

/** Whether any photo here can be looked for; ones shared from older versions have no fingerprint. */
export function canFindOnDevice(tiles) {
    return tiles.some(tile => Number.isFinite(fingerprintSize(tile.fingerprint)));
}
