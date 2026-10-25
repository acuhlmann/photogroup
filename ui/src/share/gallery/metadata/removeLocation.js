import { readBytes } from './embed/binary';
import { embedDetails } from './embed/embedDetails';
import { gpsPresent } from './embed/exifGps';
import * as jpeg from './embed/jpeg';
import * as heif from './embed/heif';
import * as mp4 from './embed/mp4';

// "Remove location when I share": take the GPS position out of a photo or
// clip on this phone, before anyone else gets it. EXIF GPS is blanked in
// place, XMP GPS fields and video location records are dropped. The result
// is read again, and a file that still has a location is an error, so a
// position never leaves by mistake.

const xmpHasGps = xml => !!xml && /GPSLatitude|GPSLongitude/.test(xml);

/** True when the file says where it was taken (JPEG, HEIC/AVIF, MP4/MOV). */
export async function hasLocation(file) {
    const head = await readBytes(file, 0, 64);
    if (jpeg.matches(head)) {
        const tiff = await jpeg.readExif(file);
        return (!!tiff && gpsPresent(tiff)) || xmpHasGps(await jpeg.readXmp(file));
    }
    // HEIF before MP4: both start with an ftyp box, told apart by brand.
    if (heif.matches(head)) {
        const { exif, xmp } = await heif.readMetadataItems(file);
        return (!!exif && gpsPresent(exif)) || xmpHasGps(xmp);
    }
    if (mp4.matches(head)) return !!(await mp4.readLocation(file));
    return false;
}

/** The file without its location, or the same file when it has none. Throws when the location stays. */
export async function withoutLocation(file) {
    if (!(await hasLocation(file))) return file;
    let blob = await embedDetails(file, { location: null });
    if (heif.matches(await readBytes(blob, 0, 64))) {
        blob = (await heif.blankExifGps(blob)) || blob;
    }
    if (blob === file || await hasLocation(blob)) {
        throw new Error(`Could not remove the location from ${file.name}`);
    }
    return new File([blob], file.name, { type: file.type, lastModified: file.lastModified });
}
