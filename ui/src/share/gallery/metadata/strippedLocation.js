import Logger from 'js-logger';
import { readBytes } from './embed/binary';
import { gpsBlanked } from './embed/exifGps';
import * as jpeg from './embed/jpeg';
import * as heif from './embed/heif';
import * as mp4 from './embed/mp4';

// Android blanks the location in photos and videos it hands to an app
// without location access (browsers have none), zeroing the bytes in place.
// The file keeps its size and every other field, so nothing looks wrong
// until the location is missing. These checks spot that pattern.

/**
 * True when the file's location was blanked on its way here: JPEG or HEIC
 * EXIF GPS zeroed, or an MP4 location box with its type wiped. Unreadable
 * files count as fine; this only flags what it can prove.
 */
export async function locationStripped(file) {
    try {
        const head = await readBytes(file, 0, 64);
        if (jpeg.matches(head)) {
            const tiff = await jpeg.readExif(file);
            return !!tiff && gpsBlanked(tiff);
        }
        // HEIF before MP4: both start with an ftyp box, told apart by brand.
        if (heif.matches(head)) {
            const { exif } = await heif.readMetadataItems(file);
            return !!exif && gpsBlanked(exif);
        }
        if (mp4.matches(head)) return await mp4.locationBlanked(file);
    } catch (err) {
        Logger.warn('Could not check ' + (file && file.name) + ' for a removed location: ' + (err.message || err));
    }
    return false;
}

/** Split files into those Android left alone and those it removed the location from. */
export async function partitionStripped(files) {
    const list = Array.from(files || []);
    const flags = await Promise.all(list.map(locationStripped));
    return {
        intact: list.filter((file, i) => !flags[i]),
        stripped: list.filter((file, i) => flags[i]),
    };
}
