import { extractLocation, isGpsKey } from './geo';

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

    /**
     * Fold GPS fields (EXIF, or XMP's exif:GPS* text) into one `x-Location`
     * {lat, long, altitude?, direction?, accuracy?, time?} and drop the raw
     * ones. GPS fields without a usable position (zeroed out, as Android does
     * when it withholds a photo's location, or 0,0) set `x-Location status`
     * to 'blank' instead, so the panel can say so rather than show NaN rows.
     */
    static processGeo(allMetadata) {
        const gpsKeys = Object.keys(allMetadata).filter(isGpsKey);
        if(!gpsKeys.length) return;
        const location = extractLocation(allMetadata);
        if(location) {
            allMetadata['x-Location'] = location;
        } else {
            allMetadata['x-Location status'] = 'blank';
        }
        gpsKeys.forEach(key => delete allMetadata[key]);
    }

}
