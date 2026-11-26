import Logger from 'js-logger';
import { readBytes } from './embed/binary';
import { brands } from './embed/isobmff';
import { cameraMakeModel, gpsPresent } from './embed/exifGps';
import * as jpeg from './embed/jpeg';
import * as heif from './embed/heif';
import * as png from './embed/png';
import * as mp4 from './embed/mp4';

// Safari on an iPhone can hand a page a copy instead of what is in the
// Photos library: without a location unless the person turns it on, and
// clips made smaller. These checks read what actually arrived, so the app
// can hold back photos whose location is missing and log the rest for a
// person to compare with the Photos app.

/**
 * What a picked file really is: {format, make, model, codec, location}.
 * `location` is true or false when the file has camera metadata to read,
 * null when it can't tell. Unreadable files give nulls.
 */
export async function describePicked(file) {
    const facts = { format: null, make: null, model: null, codec: null, location: null };
    try {
        const head = await readBytes(file, 0, 64);
        const fromTiff = tiff => {
            const camera = tiff && cameraMakeModel(tiff);
            if (camera) Object.assign(facts, camera);
            facts.location = tiff ? gpsPresent(tiff) : null;
        };
        if (jpeg.matches(head)) {
            facts.format = 'JPEG';
            fromTiff(await jpeg.readExif(file));
        } else if (heif.matches(head)) {
            // HEIF before MP4: both start with an ftyp box, told apart by brand.
            facts.format = (brands(head) || []).includes('avif') ? 'AVIF' : 'HEIC';
            fromTiff((await heif.readMetadataItems(file)).exif);
        } else if (png.matches(head)) {
            facts.format = 'PNG';
        } else if (mp4.matches(head)) {
            facts.format = (brands(head) || [])[0] === 'qt  ' ? 'MOV' : 'MP4';
            Object.assign(facts, await mp4.readCamera(file));
            facts.location = facts.make ? !!(await mp4.readLocation(file)) : null;
        }
    } catch (err) {
        Logger.warn('Could not read ' + (file && file.name) + ': ' + (err.message || err));
    }
    return facts;
}

/** True when an iPhone (or iPad) camera made it and it has no location. */
export function missingLocation(facts) {
    return facts.make === 'Apple' && facts.location === false;
}

/** "HEIC" for "IMG_1.HEIC", or null. */
function nameFormat(name) {
    const ext = String(name || '').split('.').pop().toLowerCase();
    return { heic: 'HEIC', heif: 'HEIC', jpg: 'JPEG', jpeg: 'JPEG', png: 'PNG', mov: 'MOV', mp4: 'MP4' }[ext] || null;
}

const megabytes = bytes => (bytes / 1e6).toFixed(1) + ' MB';

/**
 * One log line per picked file, so a person can compare it with the Photos
 * app (which shows format and size in MB): "Picked IMG_1.HEIC: HEIC,
 * 2.1 MB (2134567 bytes), Apple iPhone 15, location: yes".
 */
export function pickedLine(file, facts) {
    const parts = [facts.format || file.type || 'unknown type', `${megabytes(file.size)} (${file.size} bytes)`];
    const { make, model } = facts;
    const camera = make && model && model.startsWith(make) ? model : [make, model].filter(Boolean).join(' ');
    parts.push(camera || 'no camera details');
    if (facts.codec) parts.push('video ' + facts.codec);
    parts.push('location: ' + (facts.location === null ? 'unknown' : facts.location ? 'yes' : 'no'));
    const named = nameFormat(file.name);
    if (named && facts.format && named !== facts.format && !(named === 'MP4' && facts.format === 'MOV')) {
        parts.push(`the name says ${named}, but it is ${facts.format}`);
    }
    return `Picked ${file.name}: ${parts.join(', ')}`;
}

/**
 * Split an iPhone pick into files to share now and iPhone photos and clips
 * that arrived without a location. Logs what each file is.
 */
export async function partitionIPhonePick(files) {
    const list = Array.from(files || []);
    const facts = await Promise.all(list.map(describePicked));
    list.forEach((file, i) => Logger.info(pickedLine(file, facts[i])));
    return {
        intact: list.filter((file, i) => !missingLocation(facts[i])),
        held: list.filter((file, i) => missingLocation(facts[i])),
    };
}
