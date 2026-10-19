export default class ExifParser {

    static parse(allMetadata) {
        delete allMetadata['MakerNote'];

        if(allMetadata['Make'] && allMetadata['Model']) {
            // Many models already carry the brand ("Canon EOS R5")
            const make = String(allMetadata['Make']).trim();
            const model = String(allMetadata['Model']).trim();
            allMetadata['x-Camera'] = model.toLowerCase().startsWith(make.toLowerCase()) ? model : make + ' ' + model;
            //delete allMetadata['Make'];
            delete allMetadata['Model'];
        }

        this.processGeo(allMetadata);
        this.processImageSize(allMetadata);
        this.processCamSettings(allMetadata);

        delete allMetadata['undefined'];
    }

    /**
     * When both dimensions exist, replace them in place with `x-Pixel Size` in pixels.
     * Use ImageWidth/Height with ExifImageWidth/Height as fallbacks.
     */
    static processImageSize(allMetadata) {
        // exifr reports the EXIF dimensions as ExifImageWidth/Height.
        const width = allMetadata['ImageWidth'] || allMetadata['ExifImageWidth'];
        const height = allMetadata['ImageHeight'] || allMetadata['ExifImageHeight'];
        if(width && height) {
            allMetadata['x-Pixel Size'] = width + ' x ' + height;
            ['ImageWidth', 'ImageHeight', 'ExifImageWidth', 'ExifImageHeight']
                .forEach(key => delete allMetadata[key]);
        }
    }

    /** Coerce a scalar or EXIF numerator/denominator pair to a number, possibly NaN or Infinity. */
    static toNumber(value) {
        if(value && typeof value === 'object' && 'numerator' in value) {
            return Number(value.numerator) / Number(value.denominator);
        }
        return Number(value);
    }

    /**
     * "1/125 s" for fast shutters, "0.5 s" / "2 s" for long ones.
     * Return an empty string for nonfinite or nonpositive seconds; use decimal
     * seconds rounded to tenths at 0.3 s or above and a rounded reciprocal below.
     */
    static formatShutter(seconds) {
        if(!Number.isFinite(seconds) || seconds <= 0) return '';
        if(seconds >= 0.3) return (Math.round(seconds * 10) / 10) + ' s';
        return '1/' + Math.round(1 / seconds) + ' s';
    }

    /**
     * Set `x-Settings` in place when at least two exposure settings are available.
     * Accept numeric or rational EXIF values and either ISO key, preferring the
     * 35 mm equivalent focal length when positive. Leave the raw fields intact.
     */
    static processCamSettings(data) {
        // exifr names ISO "ISO" and gives plain numbers; older parsers used
        // ISOSpeedRatings and {numerator, denominator} fractions.
        const iso = data['ISO'] ?? data['ISOSpeedRatings'];
        const fNumber = ExifParser.toNumber(data['FNumber']);
        const shutter = ExifParser.toNumber(data['ExposureTime']);
        const focal = ExifParser.toNumber(data['FocalLength']);
        const focal35 = ExifParser.toNumber(data['FocalLengthIn35mmFormat']);

        const parts = [];
        if(Number.isFinite(fNumber) && fNumber > 0) parts.push('ƒ/' + (Math.round(fNumber * 10) / 10));
        const shutterText = ExifParser.formatShutter(shutter);
        if(shutterText) parts.push(shutterText);
        if(iso) parts.push('ISO ' + (Array.isArray(iso) ? iso[0] : iso));
        if(Number.isFinite(focal35) && focal35 > 0) {
            parts.push(Math.round(focal35) + ' mm');
        } else if(Number.isFinite(focal) && focal > 0) {
            parts.push((Math.round(focal * 10) / 10) + ' mm');
        }
        if(parts.length >= 2) {
            data['x-Settings'] = parts.join(' · ');
        }
    }

    static processGeo(allMetadata) {
        const gPSLatitude = allMetadata['GPSLatitude'];
        const gPSLongitude = allMetadata['GPSLongitude'];
        if(gPSLatitude && gPSLongitude) {
            // exifr already adds signed decimal latitude/longitude; fall back to
            // the DMS arrays plus their N/S/E/W references.
            const lat = Number.isFinite(allMetadata.latitude) ? allMetadata.latitude
                : ExifParser.latLongToDecimal(gPSLatitude, allMetadata['GPSLatitudeRef']);
            const long = Number.isFinite(allMetadata.longitude) ? allMetadata.longitude
                : ExifParser.latLongToDecimal(gPSLongitude, allMetadata['GPSLongitudeRef']);
            if(Number.isFinite(lat) && Number.isFinite(long)) {
                allMetadata['x-Location'] = { lat, long };
            }
            delete allMetadata['GPSLatitude'];
            delete allMetadata['GPSLongitude'];
            delete allMetadata['latitude'];
            delete allMetadata['longitude'];
        }
    }

    //credits: http://blogs.microsoft.co.il/ranw/2015/01/07/reading-gps-data-using-exif-js/
    static latLongToDecimal(number, reference) {
        if(!Array.isArray(number) || number.length < 3) return NaN;
        const [degrees, minutes, seconds] = number.map(part => (typeof part === 'number'
            ? part
            : Number(part.numerator) / Number(part.denominator)));
        const decimal = degrees + minutes / 60 + seconds / 3600;
        return reference === 'S' || reference === 'W' ? -decimal : decimal;
    }
}
