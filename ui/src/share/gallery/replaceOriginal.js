import Logger from 'js-logger';
import FileUtil from '../util/FileUtil';
import { fileForSave } from './savePhoto';
import { rememberHave } from './alreadyHave';

const copies = new Map();
const copySources = new Map();
const copyReads = new Map();

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

export function clearOriginalFiles() {
    copies.clear();
    copySources.clear();
    copyReads.clear();
}

function sourceBlob(tile) {
    return tile && (tile.elem || tile.file);
}

/**
 * Keep an in-memory copy of a photo. The save dialog truncates the chosen
 * file as soon as it is confirmed, and the upload's File points at that
 * same path, so the copy has to exist before the dialog returns.
 */
export function primePhotoCopy(tile) {
    const key = tileKey(tile);
    const source = sourceBlob(tile);
    if (!key || !source || typeof source.arrayBuffer !== 'function') return;
    if (copySources.get(key) === source) return;
    copySources.set(key, source);
    const pending = source.arrayBuffer().then(bytes => {
        if (source.size > 0 && bytes.byteLength === 0) {
            const err = new Error('Could not read the original file.');
            err.name = 'NotReadableError';
            throw err;
        }
        const copy = new Blob([bytes], { type: source.type || tile.fileType || '' });
        copies.set(key, copy);
        return copy;
    }).catch(err => {
        if (copySources.get(key) === source) copySources.delete(key);
        copies.delete(key);
        throw err;
    });
    copyReads.set(key, pending);
}

async function bytesForReplace(tile) {
    const key = tileKey(tile);
    primePhotoCopy(tile);
    let copy = key && copies.get(key);
    if (!copy && key && copyReads.get(key)) {
        copy = await copyReads.get(key);
    }
    if (copy) return fileForSave({ ...tile, elem: copy });
    const source = await fileForSave(tile);
    const bytes = await source.arrayBuffer();
    return new Blob([bytes], { type: source.type || '' });
}

/**
 * How this browser lets the person choose where a photo goes.
 * `file` opens the save dialog. `share` opens the system share sheet,
 * which is how iPhone users save into Files.
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

// The app never writes over a photo on the device: the original can hold
// a location or other metadata that the room's copy does not have.
export function replaceLabel(tile, state = {}) {
    const { replacing, replaced } = state;
    const kind = replaceKind();
    if (replaced) return 'Saved';
    if (replacing) return 'Saving…';
    if (kind === 'share') return 'Save to Files';
    if (kind === 'file') return 'Choose where to save…';
    return '';
}

export function replaceHint() {
    const kind = replaceKind();
    if (kind === 'share') return 'Opens the share sheet. Pick the folder this goes into.';
    if (kind === 'file') return 'Pick the folder this goes into. On a phone, DCIM/Camera is your gallery.';
    return '';
}

/** True where the save dialog exists: the person can name the folder a file lands in. */
export function canChooseFolder() {
    return replaceKind() === 'file';
}

/**
 * Ask where a file goes, on the tap that asks. Resolves to the chosen handle;
 * `writeChosenFile` puts bytes into it later. Throws `SaveCancelled` when the
 * dialog is closed, so a save nobody finished never counts as saved.
 *
 * Two steps because the browser opens this dialog only while the tap is still
 * fresh, and making the bytes - a room's zip, read and rewritten photo by
 * photo - can outlast that window and lose the permission. Callers whose bytes
 * are already in hand can use `saveBlobToChosenFolder`.
 */
export function chooseFileToSave(fileName, fileType = '') {
    return openDialog(fileName, fileType);
}

/** Write into the place `chooseFileToSave` returned. */
export function writeChosenFile(handle, blob) {
    return writeHandle(handle, blob);
}

/** Write bytes that are already made, straight through the save dialog. */
export async function saveBlobToChosenFolder(blob, fileName, fileType = '') {
    const handle = await openDialog(fileName, fileType);
    await writeHandle(handle, blob);
    return handle;
}

export function replaceFailureMessage(err) {
    if (!err || err.cancelled || err.name === 'SaveCancelled') return '';
    if (err.name === 'NoModificationAllowedError') return 'This file cannot be changed from the browser.';
    if (err.name === 'NotAllowedError' || err.name === 'SecurityError') return 'The browser did not allow that change.';
    if (err.name === 'NotFoundError') return 'That file is no longer there.';
    if (err.name === 'NotReadableError') return 'Could not read the original file.';
    if (typeof err.message === 'string' && err.message) return err.message;
    return 'Could not save the photo.';
}

function baseName(name) {
    const trimmed = String(name || '').split(/[/\\]/).pop().replace(/[<>:"|?*\u0000-\u001f]/g, '').trim();
    return trimmed || 'photo';
}

const START_IN = { video: 'videos', audio: 'music', zip: 'downloads', other: 'pictures' };

/** What the save dialog offers for this name: a sane folder to open in and the right extension. */
function pickerOptionsFor(suggestedName, mimeGiven) {
    const suffix = FileUtil.getFileSuffix(suggestedName);
    const ext = suffix ? suffix.toLowerCase() : '';
    const mime = MIME_BY_EXT[ext.slice(1)] || mimeGiven || '';
    const kind = mime.startsWith('video/') ? 'video'
        : mime.startsWith('audio/') ? 'audio'
            : mime === 'application/zip' ? 'zip' : 'other';
    const options = {
        suggestedName,
        // One id for every save, so the folder chosen for the first photo is
        // where the dialog opens for the second.
        id: 'photogroup-replace',
        startIn: START_IN[kind],
    };
    if (ext && mime) {
        const extensions = ext === suffix ? [ext] : [ext, suffix];
        const description = kind === 'video' ? 'Video' : kind === 'audio' ? 'Audio' : kind === 'zip' ? 'Zip archive' : 'Photo';
        options.types = [{
            description,
            accept: { [mime]: extensions },
        }];
    }
    return options;
}

/**
 * Open the browser's save dialog. It must be reached from a tap, and once per
 * file: the dialog takes one file, so a batch needs one tap each.
 */
async function openDialog(fileName, fileType) {
    if (typeof window === 'undefined' || typeof window.showSaveFilePicker !== 'function') {
        throw new Error('This browser cannot choose a folder.');
    }
    try {
        return await window.showSaveFilePicker(pickerOptionsFor(baseName(fileName), fileType));
    } catch (err) {
        if (err && err.name === 'AbortError') throw new SaveCancelled();
        throw err;
    }
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
    const blob = await bytesForReplace(tile);
    const file = namedFile(blob, tile);
    if (navigator.canShare && !navigator.canShare({ files: [file] })) {
        throw new Error('This browser cannot choose a folder.');
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
 * Save the photo, with its edits, where the person chooses. The save dialog
 * opens in the folder used last. Browsers without it (Safari, including
 * iPhone) open the share sheet. Resolves to `'replaced'` or `'shared'`.
 */
export async function replaceOriginal(tile) {
    const kind = await writeChosen(tile);
    rememberHave(tile.fingerprint, 'saved');
    return kind;
}

async function writeChosen(tile) {
    if (typeof window.showSaveFilePicker === 'function') {
        // Start the copy before the dialog. If the person picks the file the
        // photo came from, confirming the dialog empties it, and the upload's
        // File is a reference to that same path.
        const prepared = bytesForReplace(tile);
        let handle;
        try {
            handle = await openDialog(tile.fileName, tile.fileType);
        } catch (err) {
            prepared.catch(() => {});
            throw err;
        }
        const blob = await prepared;
        await writeHandle(handle, blob);
        return 'replaced';
    }

    if (typeof navigator !== 'undefined' && typeof navigator.share === 'function') {
        return shareFile(tile);
    }

    throw new Error('This browser cannot choose a folder.');
}
