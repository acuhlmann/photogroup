import Logger from 'js-logger';
import FileUtil from '../util/FileUtil';
import { fileForSave } from './savePhoto';

const HANDLE = Symbol('originalHandle');
const handles = new Map();

const MIME_BY_EXT = {
    jpg: 'image/jpeg',
    jpeg: 'image/jpeg',
    png: 'image/png',
    gif: 'image/gif',
    webp: 'image/webp',
    heic: 'image/heic',
    heif: 'image/heif',
    avif: 'image/avif',
    mp4: 'video/mp4',
    mov: 'video/quicktime',
    m4v: 'video/x-m4v',
    webm: 'video/webm',
    mp3: 'audio/mpeg',
    m4a: 'audio/mp4',
    flac: 'audio/flac',
    wav: 'audio/wav',
};

/** The user closed the picker or share sheet. Callers should stay quiet. */
export class SaveCancelled extends Error {
    constructor() {
        super('Save cancelled');
        this.name = 'SaveCancelled';
        this.cancelled = true;
    }
}

function tileKey(tile) {
    return tile && (tile.tileKey || tile.infoHash);
}

function handleOn(file) {
    return file && file[HANDLE];
}

function handleFor(tile) {
    if (!tile) return undefined;
    const key = tileKey(tile);
    return (key && handles.get(key)) || handleOn(tile.file) || handleOn(tile.elem);
}

function remember(tile, handle) {
    const key = tileKey(tile);
    if (key && handle) handles.set(key, handle);
}

function forget(tile) {
    const key = tileKey(tile);
    if (key) handles.delete(key);
    if (tile && tile.file) delete tile.file[HANDLE];
    if (tile && tile.elem && tile.elem !== tile.file) delete tile.elem[HANDLE];
}

/** Remember a writable handle on a file the user just dropped or picked. */
export function attachOriginalHandle(file, handle) {
    if (file && handle && handle.kind === 'file' && typeof handle.createWritable === 'function') {
        file[HANDLE] = handle;
    }
}

/**
 * Pair dropped files with the handles Chrome exposes on the drop, so a later
 * replace can write back without asking for the file again.
 */
export function captureDroppedHandles(dataTransfer) {
    try {
        const items = dataTransfer && dataTransfer.items;
        const files = dataTransfer && dataTransfer.files;
        if (!items || !files) return Promise.resolve();

        const tasks = [];
        let fileIndex = 0;
        for (let i = 0; i < items.length; i++) {
            const item = items[i];
            if (!item || item.kind !== 'file') continue;
            const file = files[fileIndex++];
            if (!file || typeof item.getAsFileSystemHandle !== 'function') continue;
            tasks.push(Promise.resolve()
                .then(() => item.getAsFileSystemHandle())
                .then(handle => attachOriginalHandle(file, handle))
                .catch(err => {
                    Logger.warn('Could not keep the dropped file location: ' + (err && err.message ? err.message : err));
                }));
        }
        return Promise.all(tasks).then(() => {});
    } catch (err) {
        Logger.warn('Could not keep the dropped file location: ' + (err && err.message ? err.message : err));
        return Promise.resolve();
    }
}

export function clearOriginalFiles() {
    handles.clear();
}

/** True when this photo already has a location we can try to write back to. */
export function originalReady(tile) {
    return !!handleFor(tile);
}

/**
 * How this browser can put an edited photo back on the device.
 * `file` overwrites a chosen file. `share` opens the system share sheet,
 * which is how iPhone users pick a folder and replace a same-named file.
 * `null` means the only option is a new download.
 */
export function replaceKind() {
    if (typeof window !== 'undefined' && typeof window.showSaveFilePicker === 'function') {
        return 'file';
    }
    if (typeof navigator === 'undefined' || typeof navigator.share !== 'function' || typeof navigator.canShare !== 'function') {
        return null;
    }
    try {
        const probe = new File(['x'], 'photo.jpg', { type: 'image/jpeg' });
        return navigator.canShare({ files: [probe] }) ? 'share' : null;
    } catch {
        return null;
    }
}

export function replaceLabel(tile, state = {}) {
    const { replacing, replaced } = state;
    if (replaced === 'replaced') return 'Replaced';
    if (replaced === 'shared') return 'Saved';
    const kind = replaceKind();
    if (replacing) return kind === 'share' ? 'Saving…' : 'Replacing…';
    if (kind === 'share') return 'Save to Files';
    if (originalReady(tile)) return 'Replace original';
    return 'Replace original…';
}

export function replaceHint(tile) {
    const kind = replaceKind();
    if (kind === 'share') {
        return 'Opens the share sheet. In Files, open the same folder and replace the file.';
    }
    if (kind === 'file' && originalReady(tile)) {
        return 'Writes this photo, including your edits, over the file you chose.';
    }
    if (kind === 'file') {
        return 'Pick the original file and confirm replace. Your edits are written into it.';
    }
    return '';
}

export function replaceFailureMessage(err) {
    if (!err || err.cancelled || err.name === 'SaveCancelled') return '';
    if (err.name === 'NoModificationAllowedError') return 'This file cannot be changed from the browser.';
    if (err.name === 'NotAllowedError' || err.name === 'SecurityError') return 'The browser did not allow that change.';
    if (err.name === 'NotFoundError') return 'That file is no longer there.';
    if (err.name === 'NotReadableError') return 'Could not read the original file.';
    if (typeof err.message === 'string' && err.message) return err.message;
    return 'Could not replace the original file.';
}

function baseName(name) {
    const trimmed = String(name || '').split(/[/\\]/).pop().replace(/[<>:"|?*\u0000-\u001f]/g, '').trim();
    return trimmed || 'photo';
}

function pickerOptions(tile) {
    const suggestedName = baseName(tile.fileName);
    const suffix = FileUtil.getFileSuffix(suggestedName);
    const ext = suffix ? suffix.toLowerCase() : '';
    const mime = (ext && MIME_BY_EXT[ext.slice(1)]) || tile.fileType || '';
    const options = {
        suggestedName,
        id: 'photogroup-replace',
        startIn: mime.startsWith('video/') ? 'videos' : mime.startsWith('audio/') ? 'music' : 'pictures',
    };
    if (ext && mime) {
        const extensions = ext === suffix ? [ext] : [ext, suffix];
        options.types = [{
            description: 'Photo',
            accept: { [mime]: extensions },
        }];
    }
    return options;
}

async function permissionGranted(handle) {
    if (typeof handle.queryPermission !== 'function') return true;
    let state = await handle.queryPermission({ mode: 'readwrite' });
    if (state === 'granted') return true;
    if (state === 'prompt' && typeof handle.requestPermission === 'function') {
        state = await handle.requestPermission({ mode: 'readwrite' });
        return state === 'granted';
    }
    return false;
}

/**
 * Copy the photo into memory before the destination is opened. The save
 * picker can point at the same file the upload came from, and opening it
 * for writing makes that file unreadable.
 */
async function snapshot(blob) {
    if (!blob || typeof blob.arrayBuffer !== 'function') {
        throw new Error('This photo is not ready to save yet');
    }
    const bytes = await blob.arrayBuffer();
    return new Blob([bytes], { type: blob.type || '' });
}

async function writeHandle(handle, blob) {
    let writable;
    let closed = false;
    try {
        writable = await handle.createWritable();
        await writable.write(blob);
        await writable.close();
        closed = true;
    } catch (err) {
        if (!closed && writable && typeof writable.abort === 'function') {
            try {
                await writable.abort();
            } catch {
                // The write error is the one to surface.
            }
        }
        throw err;
    }
}

function namedFile(blob, tile) {
    const name = baseName(tile.fileName);
    const type = (blob && blob.type) || tile.fileType || '';
    if (blob instanceof File && blob.name === name && blob.type === type) return blob;
    return new File([blob], name, { type });
}

async function shareFile(tile) {
    const blob = await snapshot(await fileForSave(tile));
    const file = namedFile(blob, tile);
    if (navigator.canShare && !navigator.canShare({ files: [file] })) {
        throw new Error('This browser cannot put the file back in the same place.');
    }
    try {
        await navigator.share({
            files: [file],
            title: (tile.details && tile.details.title) || file.name,
        });
    } catch (err) {
        if (err && err.name === 'AbortError') throw new SaveCancelled();
        throw err;
    }
    return 'shared';
}

/**
 * Write the edited photo over a file on the device.
 * Uses a handle captured from a drop or a previous replace when one exists.
 * Otherwise the save picker lets the user choose the original and confirm
 * the replace. Browsers without that API (Safari, including iPhone) open
 * the share sheet so the file can be saved over a same-named copy in Files.
 * Resolves to `'replaced'` or `'shared'`.
 */
export async function replaceOriginal(tile) {
    const existing = handleFor(tile);
    if (existing) {
        const allowed = await permissionGranted(existing);
        if (!allowed) {
            forget(tile);
            const denied = new Error('The browser did not allow that change.');
            denied.name = 'NotAllowedError';
            throw denied;
        }
        try {
            const blob = await snapshot(await fileForSave(tile));
            await writeHandle(existing, blob);
            remember(tile, existing);
            return 'replaced';
        } catch (err) {
            // Drop the handle so the next tap opens the picker on a fresh gesture.
            if (err && (err.name === 'NoModificationAllowedError' || err.name === 'NotFoundError')) {
                forget(tile);
            }
            Logger.warn('Could not write the original file: ' + (err.message || err.name));
            throw err;
        }
    }

    if (typeof window.showSaveFilePicker === 'function') {
        let handle;
        try {
            handle = await window.showSaveFilePicker(pickerOptions(tile));
        } catch (err) {
            if (err && err.name === 'AbortError') throw new SaveCancelled();
            throw err;
        }
        const blob = await snapshot(await fileForSave(tile));
        await writeHandle(handle, blob);
        remember(tile, handle);
        return 'replaced';
    }

    if (typeof navigator !== 'undefined' && typeof navigator.share === 'function') {
        return shareFile(tile);
    }

    throw new Error('This browser cannot put the file back in the same place.');
}
