import Logger from 'js-logger';
import { SHARED_FIELDS } from '../groupPhotoMetadata';
import { readBytes } from './binary';
import * as jpeg from './jpeg';
import * as png from './png';
import * as webp from './webp';
import * as heif from './heif';
import * as mp4 from './mp4';
import * as id3 from './id3';
import * as flac from './flac';
import * as gif from './gif';
import * as wav from './wav';
import * as ogg from './ogg';
import * as mkv from './mkv';

// Write the room's shared details (title, description, rating) into a saved
// file's own metadata, so the edits travel with it instead of only living
// on the server. The format is picked from the file's leading bytes; files
// no writer understands are returned unchanged.

// HEIF before MP4: both start with an ftyp box, told apart by brand.
const WRITERS = [jpeg, png, webp, gif, heif, mp4, mkv, id3, flac, wav, ogg];

/** The shared fields someone actually set, or null when there are none. */
function sharedChanges(details) {
    if (!details) return null;
    const changes = {};
    SHARED_FIELDS.forEach(key => {
        if (details[key] !== undefined) changes[key] = details[key];
    });
    return Object.keys(changes).length ? changes : null;
}

/**
 * Return the file with its shared details embedded, or the original file
 * when nothing was edited, the format is not supported, or its layout is
 * one the writer leaves alone. With `originalFingerprint`, formats with XMP
 * also note which original the edited copy came from.
 */
export async function embedDetails(blob, details, { originalFingerprint } = {}) {
    let changes = sharedChanges(details);
    if (!changes || !blob || typeof blob.slice !== 'function') return blob;
    if (originalFingerprint) changes = { ...changes, originalFingerprint };

    const head = await readBytes(blob, 0, 64);
    const writer = WRITERS.find(item => item.matches(head));
    if (!writer) return blob;
    const result = await writer.embed(blob, changes);
    if (!result) Logger.info('Saving without photo details; this file layout is not supported');
    return result || blob;
}
